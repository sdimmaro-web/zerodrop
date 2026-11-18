"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1");
const BASE_URL = String(process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const STEAM_API_KEY = String(process.env.STEAM_API_KEY || "").trim();
const STEAM_API_BASE = String(process.env.STEAM_API_BASE || "https://api.steampowered.com").replace(/\/+$/, "");
const COOKIE_NAME = "doodrop.sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_IDENTIFIER = "http://specs.openid.net/auth/2.0/identifier_select";
const PROJECT_ROOT = __dirname;

const sessions = new Map();
const usedNonces = new Map();
// онлайн: id клиента -> lastSeen
const onlineClients = new Map();
const ONLINE_TTL_MS = 5 * 60 * 1000;

function touchOnline(clientId) {
    if (!clientId) return;
    onlineClients.set(String(clientId), Date.now());
}

function getOnlineCount() {
    const now = Date.now();
    let n = 0;
    for (const [id, t] of onlineClients) {
        if (now - t < ONLINE_TTL_MS) n++;
        else onlineClients.delete(id);
    }
    return Math.max(1, n);
}

function handleOnline(req, res) {
    // id из cookie сессии или из query/body
    const session = getSession(req, res, true);
    let clientId = null;
    if (session && session.user && session.user.steamId) {
        clientId = "s:" + session.user.steamId;
    } else if (session) {
        // анонимная сессия
        const sid = (req.headers.cookie || "").match(/(?:^|;\s*)sid=([^;]+)/);
        clientId = sid ? "a:" + decodeURIComponent(sid[1]) : "a:" + Math.random().toString(36).slice(2);
        if (!session._onlineId) session._onlineId = clientId;
        clientId = session._onlineId;
    }
    touchOnline(clientId);
    if (session) session.expiresAt = Date.now() + SESSION_TTL_MS;
    return sendJson(res, 200, { online: getOnlineCount() });
}

const { getSkinInfo } = require("./api/steam_market");
const SKINS_FILE = path.join(PROJECT_ROOT, "skins", "skins.json");

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url, BASE_URL);
        const pathname = decodeURIComponent(requestUrl.pathname);

        setSecurityHeaders(res);

        if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
            return sendText(res, 405, "Method Not Allowed");
        }

        if (pathname === "/health") {
            return sendJson(res, 200, { ok: true });
        }

        if (pathname === "/api/online") {
            return handleOnline(req, res);
        }

        if (pathname === "/api/me") {
            return await handleCurrentUser(req, res);
        }

        if (pathname === "/api/account") {
            if (req.method === "GET" || req.method === "HEAD") {
                return handleGetAccount(req, res);
            }
            if (req.method === "POST") {
                return await handleUpdateAccount(req, res);
            }
        }

        if (pathname === "/api/skin-info") {
            return await handleSkinInfo(req, res, requestUrl);
        }

        if (pathname === "/api/skins") {
            if (req.method === "GET" || req.method === "HEAD") {
                return handleListSkins(req, res);
            }
            if (req.method === "POST") {
                return await handleAddSkin(req, res);
            }
        }

        if (pathname === "/admin/add_skin.html" || pathname === "/admin/") {
            return sendFile(res, path.join(PROJECT_ROOT, "admin", "add_skin.html"), req.method === "HEAD");
        }

        if (pathname === "/auth/steam") {
            return handleSteamStart(req, res);
        }

        if (pathname === "/auth/steam/return") {
            return await handleSteamReturn(req, res, requestUrl);
        }

        if (pathname === "/auth/logout") {
            return handleLogout(req, res);
        }

        if (pathname === "/" || pathname === "/index.html") {
            return sendFile(res, path.join(PROJECT_ROOT, "index.html"), req.method === "HEAD");
        }

        if (pathname === "/profile.html") {
            return sendFile(res, path.join(PROJECT_ROOT, "profile.html"), req.method === "HEAD");
        }

        if (pathname === "/case.html") {
            return sendFile(res, path.join(PROJECT_ROOT, "case.html"), req.method === "HEAD");
        }

        // любые html в корне (upgrade/contracts/inventory и т.д.)
        if (/^\/[a-zA-Z0-9_-]+\.html$/.test(pathname)) {
            const htmlPath = path.join(PROJECT_ROOT, pathname.slice(1));
            if (fs.existsSync(htmlPath)) {
                return sendFile(res, htmlPath, req.method === "HEAD");
            }
        }

        if (pathname === "/api/cases") {
            if (req.method === "GET" || req.method === "HEAD") {
                return handleListCases(req, res);
            }
            if (req.method === "POST") {
                return await handleCaseAction(req, res);
            }
        }

        const staticMatch = pathname.match(/^\/(css|js|images|skins)\/(.+)$/);
        if (staticMatch) {
            const folder = staticMatch[1];
            const relativeFile = staticMatch[2];
            const baseDirectory = path.join(PROJECT_ROOT, folder);
            const filePath = path.resolve(baseDirectory, relativeFile);

            if (!isInside(baseDirectory, filePath)) {
                return sendText(res, 403, "Forbidden");
            }

            return sendFile(res, filePath, req.method === "HEAD");
        }

        return sendText(res, 404, "Страница не найдена");
    } catch (error) {
        console.error("Request error:", error);
        return sendText(res, 500, "Внутренняя ошибка сервера");
    }
});

server.listen(PORT, HOST, () => {
    console.log("========================================");
    console.log("DOODROP Steam server запущен");
    console.log(`Локальный адрес: http://${HOST}:${PORT}`);
    console.log(`Steam BASE_URL: ${BASE_URL}`);
    console.log(`Steam API key: ${STEAM_API_KEY ? "установлен" : "НЕ установлен"}`);
    console.log("========================================");

    if (!STEAM_API_KEY) {
        console.warn("ВНИМАНИЕ: без STEAM_API_KEY SteamID будет подтверждён, но ник и аватар не загрузятся.");
    }
});

setInterval(cleanupExpiredData, 10 * 60 * 1000).unref();


function readSkins() {
    try {
        if (!fs.existsSync(SKINS_FILE)) return [];
        const raw = fs.readFileSync(SKINS_FILE, "utf8");
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("readSkins error:", error.message);
        return [];
    }
}

function writeSkins(skins) {
    const dir = path.dirname(SKINS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
        if (fs.existsSync(SKINS_FILE)) {
            const prev = fs.readFileSync(SKINS_FILE, "utf8");
            if (prev && prev.trim() && prev.trim() !== "[]") {
                fs.writeFileSync(path.join(dir, "skins.backup.json"), prev, "utf8");
            }
        }
    } catch (e) {
        console.warn("skins backup skip:", e.message);
    }
    fs.writeFileSync(SKINS_FILE, JSON.stringify(skins, null, 2), "utf8");
}

async function handleSkinInfo(req, res, requestUrl) {
    const name = (requestUrl.searchParams.get("name") || requestUrl.searchParams.get("market_hash_name") || "").trim();
    if (!name) {
        return sendJson(res, 400, { error: "Параметр name обязателен. Пример: ?name=AK-47 | Redline (Field-Tested)" });
    }

    try {
        const info = await getSkinInfo(name);
        return sendJson(res, 200, info);
    } catch (error) {
        console.error("skin-info error:", error.message);
        return sendJson(res, 404, { error: error.message || "Скин не найден" });
    }
}



function casesFilePath() {
    return path.join(PROJECT_ROOT, "skins", "cases.json");
}

function casesBackupPath() {
    return path.join(PROJECT_ROOT, "skins", "cases.backup.json");
}

function readCasesFromFile(file) {
    try {
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, "utf8");
        if (!raw || !raw.trim()) return null;
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : null;
    } catch (e) {
        console.error("readCasesFromFile:", file, e.message);
        return null;
    }
}

function readCases() {
    // 1) основной файл
    const main = readCasesFromFile(casesFilePath());
    if (main && main.length) return main;

    // 2) если основной пустой/битый — пробуем backup (чтобы не сбрасывать залитые скины)
    const bak = readCasesFromFile(casesBackupPath());
    if (bak && bak.length) {
        console.warn("cases.json пуст/битый — восстановлен из cases.backup.json");
        try {
            fs.writeFileSync(casesFilePath(), JSON.stringify(bak, null, 2), "utf8");
        } catch (e) {
            console.error("restore backup failed:", e.message);
        }
        return bak;
    }

    return main || [];
}

function writeCases(cases) {
    const file = casesFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // бэкап текущего файла перед перезаписью
    try {
        if (fs.existsSync(file)) {
            const prev = fs.readFileSync(file, "utf8");
            if (prev && prev.trim() && prev.trim() !== "[]") {
                fs.writeFileSync(casesBackupPath(), prev, "utf8");
            }
        }
    } catch (e) {
        console.warn("cases backup skip:", e.message);
    }

    fs.writeFileSync(file, JSON.stringify(cases, null, 2), "utf8");
}

function defaultCasesFromSkins() {
    // Только если вообще нет сохранённых кейсов. Не затирает пользовательские данные.
    return [
        { id: 0, name: "ФРЕДДИ КРЮГЕР", price: 8999, image: "/images/case_freddy.png", items: [] },
        { id: 1, name: "M4A4 ВСЕМ", price: 599, image: "/images/case_m4a4.png", items: [] },
        { id: 2, name: "AK-47 ВСЕМ", price: 399, image: "/images/case_ak47.png", items: [] },
        { id: 3, name: "M4A1-S ВСЕМ", price: 299, image: "/images/case_m4a1s.png", items: [] },
        { id: 4, name: "НОЖИ", price: 12999, image: "/images/case_freddy.png", items: [] }
    ];
}

function ensureCases() {
    let cases = readCases();
    // Создаём дефолт ТОЛЬКО если нет ни основного файла, ни backup
    if (!cases.length) {
        const mainExists = fs.existsSync(casesFilePath());
        const bakExists = fs.existsSync(casesBackupPath());
        if (mainExists || bakExists) {
            // файл есть, но пустой — не затираем молча, отдаём как есть
            console.warn("cases.json пустой, дефолты НЕ записаны (чтобы не сбросить данные)");
            return cases;
        }
        cases = defaultCasesFromSkins();
        writeCases(cases);
        console.log("Создан новый cases.json с пустыми кейсами");
    }
    return cases;
}

function handleListCases(req, res) {
    res.setHeader("Cache-Control", "no-store");
    return sendJson(res, 200, { cases: ensureCases() });
}

function toCaseItem(skin) {
    return {
        name: skin.name || skin.market_hash_name,
        market_hash_name: skin.market_hash_name || "",
        image: skin.image || skin.image_large || "",
        price: Number(skin.price) || 0,
        rarity: skin.rarity || "Unknown"
    };
}

async function handleCaseAction(req, res) {
    try {
        const body = await readJsonBody(req);
        const action = String(body.action || "add_skin").trim();
        let cases = ensureCases();

        if (action === "create_case") {
            const name = String(body.name || "").trim();
            if (!name) return sendJson(res, 400, { error: "Укажите название кейса" });
            const nextId = cases.reduce((m, c) => Math.max(m, Number(c.id) || 0), -1) + 1;
            const created = {
                id: nextId,
                name,
                price: Number(body.price) || 0,
                image: body.image || "/images/ak47_1.avif",
                items: []
            };
            cases.push(created);
            writeCases(cases);
            return sendJson(res, 200, { ok: true, case: created, cases });
        }

        if (action === "add_skin") {
            const caseId = Number(body.case_id);
            const caseRef = cases.find((c) => Number(c.id) === caseId);
            if (!caseRef) return sendJson(res, 404, { error: "Кейс не найден" });

            let skin = body.skin || null;
            const marketHashName = String(body.market_hash_name || skin?.market_hash_name || body.name || "").trim();

            // если передан только hash — подтянуть с маркета
            if ((!skin || !skin.image) && marketHashName && body.auto !== false) {
                const info = await getSkinInfo(marketHashName);
                skin = {
                    name: info.name,
                    market_hash_name: info.market_hash_name,
                    image: info.image || info.image_large || "",
                    price: info.price || 0,
                    rarity: info.rarity || "Unknown"
                };
            }

            if (!skin && marketHashName) {
                skin = {
                    name: body.name || marketHashName,
                    market_hash_name: marketHashName,
                    image: body.image || "",
                    price: Number(body.price) || 0,
                    rarity: body.rarity || "Unknown"
                };
            }

            if (!skin) return sendJson(res, 400, { error: "Не передан скин" });

            const item = toCaseItem(skin);
            if (!Array.isArray(caseRef.items)) caseRef.items = [];

            const existing = caseRef.items.findIndex(
                (it) =>
                    (item.market_hash_name && it.market_hash_name === item.market_hash_name) ||
                    it.name === item.name
            );
            if (existing >= 0) caseRef.items[existing] = { ...caseRef.items[existing], ...item };
            else caseRef.items.push(item);

            // параллельно сохраняем в общий каталог скинов
            const skins = readSkins();
            if (item.market_hash_name) {
                const sidx = skins.findIndex((s) => s.market_hash_name === item.market_hash_name);
                if (sidx >= 0) skins[sidx] = { ...skins[sidx], ...item };
                else skins.push({ ...item, updated_at: new Date().toISOString() });
                writeSkins(skins);
            }

            writeCases(cases);
            return sendJson(res, 200, {
                ok: true,
                case: caseRef,
                item,
                total_items: caseRef.items.length
            });
        }

        if (action === "remove_skin") {
            const caseId = Number(body.case_id);
            const caseRef = cases.find((c) => Number(c.id) === caseId);
            if (!caseRef) return sendJson(res, 404, { error: "Кейс не найден" });
            const key = String(body.market_hash_name || body.name || "").trim();
            caseRef.items = (caseRef.items || []).filter(
                (it) => it.market_hash_name !== key && it.name !== key
            );
            writeCases(cases);
            return sendJson(res, 200, { ok: true, case: caseRef });
        }

        if (action === "bulk_add_skins") {
            const caseId = Number(body.case_id);
            const caseRef = cases.find((c) => Number(c.id) === caseId);
            if (!caseRef) return sendJson(res, 404, { error: "Кейс не найден" });
            if (!Array.isArray(caseRef.items)) caseRef.items = [];

            let names = [];
            if (Array.isArray(body.names)) {
                names = body.names.map((n) => String(n || "").trim()).filter(Boolean);
            } else if (typeof body.text === "string") {
                names = body.text.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
            }
            // unique preserve order
            const seen = new Set();
            names = names.filter((n) => {
                const k = n.toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });

            if (!names.length) {
                return sendJson(res, 400, { error: "Список скинов пуст" });
            }
            if (names.length > 50) {
                return sendJson(res, 400, { error: "Максимум 50 скинов за раз" });
            }

            const results = [];
            const skins = readSkins();

            for (const marketHashName of names) {
                try {
                    const info = await getSkinInfo(marketHashName);
                    const item = toCaseItem({
                        name: info.name,
                        market_hash_name: info.market_hash_name,
                        image: info.image || info.image_large || "",
                        price: info.price || 0,
                        rarity: info.rarity || "Unknown"
                    });

                    const existing = caseRef.items.findIndex(
                        (it) =>
                            (item.market_hash_name && it.market_hash_name === item.market_hash_name) ||
                            it.name === item.name
                    );
                    if (existing >= 0) caseRef.items[existing] = { ...caseRef.items[existing], ...item };
                    else caseRef.items.push(item);

                    if (item.market_hash_name) {
                        const sidx = skins.findIndex((s) => s.market_hash_name === item.market_hash_name);
                        if (sidx >= 0) skins[sidx] = { ...skins[sidx], ...item, updated_at: new Date().toISOString() };
                        else skins.push({ ...item, updated_at: new Date().toISOString() });
                    }

                    results.push({
                        ok: true,
                        name: item.name,
                        market_hash_name: item.market_hash_name,
                        price: item.price,
                        image: item.image
                    });
                } catch (err) {
                    results.push({
                        ok: false,
                        name: marketHashName,
                        error: err.message || "Ошибка"
                    });
                }
            }

            writeSkins(skins);
            writeCases(cases);
            const okCount = results.filter((r) => r.ok).length;
            return sendJson(res, 200, {
                ok: true,
                added: okCount,
                failed: results.length - okCount,
                total_items: caseRef.items.length,
                results,
                case: caseRef
            });
        }

        if (action === "update_case") {
            const caseId = Number(body.case_id);
            const caseRef = cases.find((c) => Number(c.id) === caseId);
            if (!caseRef) return sendJson(res, 404, { error: "Кейс не найден" });
            if (body.name) caseRef.name = String(body.name);
            if (body.price != null) caseRef.price = Number(body.price) || 0;
            if (body.image) caseRef.image = String(body.image);
            writeCases(cases);
            return sendJson(res, 200, { ok: true, case: caseRef });
        }

        return sendJson(res, 400, { error: "Неизвестное action. Используйте: add_skin, bulk_add_skins, remove_skin, create_case, update_case" });
    } catch (error) {
        console.error("case action error:", error.message);
        return sendJson(res, 500, { error: error.message || "Ошибка кейса" });
    }
}

function handleListSkins(req, res) {
    res.setHeader("Cache-Control", "no-store");
    return sendJson(res, 200, { skins: readSkins() });
}

async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > 1_000_000) {
                reject(new Error("Body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                const text = Buffer.concat(chunks).toString("utf8");
                resolve(text ? JSON.parse(text) : {});
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

async function handleAddSkin(req, res) {
    try {
        const body = await readJsonBody(req);
        const marketHashName = String(body.market_hash_name || body.name || "").trim();
        if (!marketHashName) {
            return sendJson(res, 400, { error: "Укажите market_hash_name" });
        }

        // Auto-fetch from Steam if price/image not provided
        let info;
        if (body.auto !== false) {
            info = await getSkinInfo(marketHashName);
        } else {
            info = {
                name: body.name || marketHashName,
                market_hash_name: marketHashName,
                image: body.image || "",
                price: Number(body.price) || 0,
                rarity: body.rarity || "Unknown"
            };
        }

        const skins = readSkins();
        const idx = skins.findIndex((s) => s.market_hash_name === info.market_hash_name);
        const entry = {
            name: info.name,
            market_hash_name: info.market_hash_name,
            image: info.image || info.image_large || "",
            price: info.price || 0,
            price_text: info.price_text || null,
            median_price: info.median_price || 0,
            rarity: body.rarity || info.rarity || "Unknown",
            volume: info.volume || null,
            updated_at: info.updated_at || new Date().toISOString()
        };

        if (idx >= 0) {
            skins[idx] = { ...skins[idx], ...entry };
        } else {
            skins.push(entry);
        }

        writeSkins(skins);
        return sendJson(res, 200, { ok: true, skin: entry, total: skins.length });
    } catch (error) {
        console.error("add skin error:", error.message);
        return sendJson(res, 500, { error: error.message || "Не удалось добавить скин" });
    }
}


const DEFAULT_USER_BALANCE = 1000;

function usersFilePath() {
    return path.join(PROJECT_ROOT, "data", "users.json");
}

function readUsersDb() {
    try {
        const file = usersFilePath();
        if (!fs.existsSync(file)) return {};
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return data && typeof data === "object" ? data : {};
    } catch (e) {
        console.error("readUsersDb:", e.message);
        return {};
    }
}

function writeUsersDb(db) {
    const file = usersFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2), "utf8");
}

function getAccount(steamId) {
    const id = String(steamId || "");
    if (!id) return null;
    const db = readUsersDb();
    if (!db[id]) {
        db[id] = {
            steamId: id,
            balance: DEFAULT_USER_BALANCE,
            inventory: [],
            bestDrop: null,
            openedCases: 0,
            moneySpent: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        writeUsersDb(db);
    }
    const acc = db[id];
    if (acc && !Object.prototype.hasOwnProperty.call(acc, "bestDrop")) {
        // миграция: если bestDrop ещё нет — взять самый дорогой из инвентаря (один раз)
        let best = null;
        for (const it of (acc.inventory || [])) {
            if (!best || (Number(it.price) || 0) > (Number(best.price) || 0)) best = it;
        }
        acc.bestDrop = best ? {
            name: best.name,
            market_hash_name: best.market_hash_name || "",
            image: best.image || "",
            price: Number(best.price) || 0,
            rarity: best.rarity || "Unknown",
            from_case: best.from_case || "",
            won_at: best.won_at || null
        } : null;
        db[id] = acc;
        writeUsersDb(db);
    }
    return db[id];
}

function saveAccount(account) {
    const id = String(account.steamId || "");
    if (!id) return;
    const db = readUsersDb();
    account.updatedAt = new Date().toISOString();
    db[id] = account;
    writeUsersDb(db);
    return account;
}

function requireAuth(req, res) {
    const session = getSession(req, res, false);
    if (!session || !session.user || !session.user.steamId) {
        sendJson(res, 401, { authenticated: false, error: "Войдите через Steam" });
        return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session;
}

async function handleCurrentUser(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const session = getSession(req, res, false);

    if (!session || !session.user) {
        return sendJson(res, 401, { authenticated: false });
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;

    // Если ник/аватар не загрузились при логине — подтянуть сейчас (без повторного входа)
    if (session.user.profileLoaded === false || !session.user.name || session.user.name === "Steam Player") {
        try {
            const fresh = await loadSteamProfile(session.user.steamId);
            if (fresh) {
                session.user = { ...session.user, ...fresh };
            }
        } catch (e) {
            console.warn("profile refresh:", e.message);
        }
    }

    const account = getAccount(session.user.steamId);
    return sendJson(res, 200, {
        authenticated: true,
        ...session.user,
        balance: account.balance,
        inventory: account.inventory || [],
        bestDrop: account.bestDrop || null,
        openedCases: account.openedCases || 0,
        moneySpent: account.moneySpent || 0
    });
}

function handleGetAccount(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const session = requireAuth(req, res);
    if (!session) return;

    const account = getAccount(session.user.steamId);
    return sendJson(res, 200, {
        authenticated: true,
        steamId: account.steamId,
        balance: account.balance,
        inventory: account.inventory || [],
        bestDrop: account.bestDrop || null,
        openedCases: account.openedCases || 0,
        moneySpent: account.moneySpent || 0
    });
}

async function handleUpdateAccount(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const session = requireAuth(req, res);
    if (!session) return;

    try {
        const body = await readJsonBody(req);
        const action = String(body.action || "").trim();
        const account = getAccount(session.user.steamId);

        if (action === "set_balance") {
            account.balance = Math.max(0, Math.round(Number(body.balance) || 0));
        } else if (action === "add_balance") {
            account.balance = Math.max(0, Math.round((Number(account.balance) || 0) + (Number(body.amount) || 0)));
        } else if (action === "open_case") {
            // price = итоговая сумма (unit * count). items[] — все выигранные предметы (мульти-открытие)
            const price = Math.max(0, Math.round(Number(body.price) || 0));
            if ((Number(account.balance) || 0) < price) {
                return sendJson(res, 400, { error: "Недостаточно средств", balance: account.balance });
            }

            let wins = [];
            if (Array.isArray(body.items) && body.items.length) {
                wins = body.items;
            } else if (body.item) {
                wins = [body.item];
            }
            const count = Math.max(1, Math.min(20, wins.length || Number(body.count) || 1));
            // цена одного кейса (для лимита дропа)
            const unitCasePrice = Math.max(
                0,
                Number(body.case_price) || (count > 0 ? price / count : price) || 0
            );
            // дроп не дороже 1.5× цены кейса
            const maxDropPrice = unitCasePrice > 0 ? unitCasePrice * 1.5 : Infinity;
            for (const w of wins) {
                const p = Number(w && w.price) || 0;
                if (p > maxDropPrice + 0.01) {
                    return sendJson(res, 400, {
                        error: "Дроп превышает лимит 1.5× цены кейса",
                        max_drop: Math.round(maxDropPrice * 100) / 100
                    });
                }
            }

            account.balance = Math.max(0, Math.round((Number(account.balance) || 0) - price));
            account.openedCases = (Number(account.openedCases) || 0) + count;
            account.moneySpent = (Number(account.moneySpent) || 0) + price;

            if (!Array.isArray(account.inventory)) account.inventory = [];
            const added = [];
            for (let i = 0; i < wins.length; i++) {
                const win = wins[i] || {};
                const wonItem = {
                    id: String(Date.now()) + "_" + i + "_" + Math.random().toString(36).slice(2, 8),
                    name: win.name || "Скин",
                    market_hash_name: win.market_hash_name || "",
                    image: win.image || "",
                    price: Number(win.price) || 0,
                    rarity: win.rarity || "Unknown",
                    from_case: win.from_case || body.case_name || "",
                    won_at: new Date().toISOString()
                };
                account.inventory.unshift(wonItem);
                added.push(wonItem);

                const prevBest = account.bestDrop || null;
                const prevPrice = prevBest ? (Number(prevBest.price) || 0) : -1;
                if ((Number(wonItem.price) || 0) > prevPrice) {
                    account.bestDrop = {
                        name: wonItem.name,
                        market_hash_name: wonItem.market_hash_name,
                        image: wonItem.image,
                        price: wonItem.price,
                        rarity: wonItem.rarity,
                        from_case: wonItem.from_case,
                        won_at: wonItem.won_at
                    };
                }
            }
            // сохраняем сразу, чтобы мульти-открытие не потерялось
            saveAccount(account);
            return sendJson(res, 200, {
                ok: true,
                balance: account.balance,
                inventory: account.inventory,
                bestDrop: account.bestDrop || null,
                openedCases: account.openedCases || 0,
                moneySpent: account.moneySpent || 0,
                items: added,
                item: added[0] || null
            });
        } else if (action === "sell_item") {
            const itemId = String(body.item_id || "");
            if (!Array.isArray(account.inventory)) account.inventory = [];
            const idx = account.inventory.findIndex((it) => String(it.id) === itemId);
            if (idx < 0) return sendJson(res, 404, { error: "Предмет не найден" });
            const item = account.inventory[idx];
            const price = Math.max(0, Math.round(Number(item.price) || 0));
            account.inventory.splice(idx, 1);
            account.balance = Math.max(0, Math.round((Number(account.balance) || 0) + price));
            saveAccount(account);
            return sendJson(res, 200, {
                ok: true,
                balance: account.balance,
                inventory: account.inventory,
                sold: item,
                soldTotal: price
            });
        } else if (action === "sell_items") {
            // продать несколько предметов сразу
            if (!Array.isArray(account.inventory)) account.inventory = [];
            const ids = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
            if (!ids.length) return sendJson(res, 400, { error: "Нет предметов для продажи" });
            const unique = [...new Set(ids)];
            let soldTotal = 0;
            const sold = [];
            // удаляем с конца по индексам
            const toRemove = [];
            for (const id of unique) {
                const idx = account.inventory.findIndex((it) => String(it.id) === id);
                if (idx >= 0) toRemove.push(idx);
            }
            toRemove.sort((a, b) => b - a);
            for (const idx of toRemove) {
                const item = account.inventory[idx];
                const price = Math.max(0, Math.round(Number(item.price) || 0));
                soldTotal += price;
                sold.push(item);
                account.inventory.splice(idx, 1);
            }
            account.balance = Math.max(0, Math.round((Number(account.balance) || 0) + soldTotal));
            saveAccount(account);
            return sendJson(res, 200, {
                ok: true,
                balance: account.balance,
                inventory: account.inventory,
                sold,
                soldTotal
            });
        } else if (action === "upgrade") {
            if (!Array.isArray(account.inventory)) account.inventory = [];
            const inputId = String(body.input_item_id || "");
            const balanceAdd = Math.max(0, Math.round(Number(body.balance_add) || 0));
            const target = body.target || null;
            if (!inputId) return sendJson(res, 400, { error: "Не выбран предмет" });
            if (!target || !(Number(target.price) > 0)) {
                return sendJson(res, 400, { error: "Не выбрана цель апгрейда" });
            }
            const idx = account.inventory.findIndex((it) => String(it.id) === inputId);
            if (idx < 0) return sendJson(res, 404, { error: "Предмет не найден в инвентаре" });
            const inputItem = account.inventory[idx];
            const inputPrice = Math.max(0, Number(inputItem.price) || 0);
            const targetPrice = Math.max(0, Number(target.price) || 0);
            if (targetPrice <= inputPrice) {
                return sendJson(res, 400, { error: "Цель должна быть дороже входного предмета" });
            }
            if ((Number(account.balance) || 0) < balanceAdd) {
                return sendJson(res, 400, { error: "Недостаточно средств", balance: account.balance });
            }
            // серверный шанс — не доверяем клиенту, потолок 75%
            let chance = ((inputPrice + balanceAdd) / targetPrice) * 100;
            if (chance > 75) chance = 75;
            if (chance < 0) chance = 0;
            chance = Math.round(chance * 100) / 100;
            if (chance <= 0) return sendJson(res, 400, { error: "Шанс слишком низкий" });
            // не даём докинуть баланс сверх 75%
            const maxAdd = Math.max(0, Math.ceil(targetPrice * 0.75 - inputPrice));
            if (balanceAdd > maxAdd) {
                return sendJson(res, 400, { error: "Максимальный шанс апгрейда — 75%" });
            }

            // списываем входной предмет и доп. баланс
            account.inventory.splice(idx, 1);
            account.balance = Math.max(0, Math.round((Number(account.balance) || 0) - balanceAdd));
            account.moneySpent = (Number(account.moneySpent) || 0) + balanceAdd;

            const roll = Math.random() * 100;
            const won = roll < chance;
            let wonItem = null;
            if (won) {
                wonItem = {
                    id: String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8),
                    name: target.name || "Скин",
                    market_hash_name: target.market_hash_name || "",
                    image: target.image || "",
                    price: targetPrice,
                    rarity: target.rarity || "Unknown",
                    from_case: "Апгрейд",
                    won_at: new Date().toISOString()
                };
                account.inventory.unshift(wonItem);
                const prevBest = account.bestDrop || null;
                const prevPrice = prevBest ? (Number(prevBest.price) || 0) : -1;
                if (targetPrice > prevPrice) {
                    account.bestDrop = {
                        name: wonItem.name,
                        market_hash_name: wonItem.market_hash_name,
                        image: wonItem.image,
                        price: wonItem.price,
                        rarity: wonItem.rarity,
                        from_case: wonItem.from_case,
                        won_at: wonItem.won_at
                    };
                }
            }
            saveAccount(account);
            return sendJson(res, 200, {
                ok: true,
                won,
                chance,
                roll: Math.round(roll * 100) / 100,
                balance: account.balance,
                inventory: account.inventory,
                bestDrop: account.bestDrop || null,
                item: wonItem,
                moneySpent: account.moneySpent || 0
            });
        } else if (action === "contract") {
            // Контракт как на Case Battle: 3–10 предметов → 1 предмет в диапазоне цены
            if (!Array.isArray(account.inventory)) account.inventory = [];
            const ids = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
            if (ids.length < 3) {
                return sendJson(res, 400, { error: "Нужно минимум 3 предмета" });
            }
            if (ids.length > 10) {
                return sendJson(res, 400, { error: "Максимум 10 предметов" });
            }
            // уникальные id
            const uniqueIds = [...new Set(ids)];
            if (uniqueIds.length !== ids.length) {
                return sendJson(res, 400, { error: "Дубликаты предметов в контракте" });
            }
            const picked = [];
            for (const id of uniqueIds) {
                const idx = account.inventory.findIndex((it) => String(it.id) === id);
                if (idx < 0) {
                    return sendJson(res, 404, { error: "Предмет не найден в инвентаре" });
                }
                picked.push({ idx, item: account.inventory[idx] });
            }
            let sum = 0;
            for (const p of picked) sum += Math.max(0, Number(p.item.price) || 0);
            sum = Math.round(sum * 100) / 100;
            if (sum <= 0) return sendJson(res, 400, { error: "Сумма контракта слишком мала" });

            // диапазон результата ~0.33x … 4.5x суммы
            const minPrice = Math.max(1, Math.round(sum * 0.33 * 100) / 100);
            const maxPrice = Math.max(minPrice + 1, Math.round(sum * 4.5 * 100) / 100);

            // каталог скинов
            let catalog = [];
            try {
                catalog = JSON.parse(fs.readFileSync(SKINS_FILE, "utf8"));
                if (!Array.isArray(catalog)) catalog = [];
            } catch (_) {
                catalog = [];
            }
            let candidates = catalog.filter((s) => {
                const p = Number(s.price) || 0;
                return p >= minPrice && p <= maxPrice;
            });
            // если пусто — расширяем диапазон
            if (!candidates.length) {
                candidates = catalog.filter((s) => {
                    const p = Number(s.price) || 0;
                    return p >= minPrice * 0.5 && p <= maxPrice * 1.5 && p > 0;
                });
            }
            if (!candidates.length) {
                candidates = catalog.filter((s) => (Number(s.price) || 0) > 0);
            }
            if (!candidates.length) {
                return sendJson(res, 500, { error: "Нет подходящих скинов в каталоге" });
            }

            // взвешенный выбор ближе к середине диапазона
            const mid = (minPrice + maxPrice) / 2;
            const weights = candidates.map((s) => {
                const p = Number(s.price) || mid;
                const dist = Math.abs(p - mid) / Math.max(1, mid);
                return Math.max(0.05, 1 - dist * 0.7);
            });
            const totalW = weights.reduce((a, b) => a + b, 0);
            let r = Math.random() * totalW;
            let chosen = candidates[0];
            for (let i = 0; i < candidates.length; i++) {
                r -= weights[i];
                if (r <= 0) {
                    chosen = candidates[i];
                    break;
                }
            }

            // удаляем предметы (с конца индексов чтобы не сбить порядок)
            const sortedIdx = picked.map((p) => p.idx).sort((a, b) => b - a);
            for (const idx of sortedIdx) {
                account.inventory.splice(idx, 1);
            }

            const wonItem = {
                id: String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8),
                name: chosen.name || "Скин",
                market_hash_name: chosen.market_hash_name || "",
                image: chosen.image || "",
                price: Math.round((Number(chosen.price) || 0) * 100) / 100,
                rarity: chosen.rarity || "Unknown",
                from_case: "Контракт",
                won_at: new Date().toISOString()
            };
            account.inventory.unshift(wonItem);

            const prevBest = account.bestDrop || null;
            const prevPrice = prevBest ? (Number(prevBest.price) || 0) : -1;
            if (wonItem.price > prevPrice) {
                account.bestDrop = {
                    name: wonItem.name,
                    market_hash_name: wonItem.market_hash_name,
                    image: wonItem.image,
                    price: wonItem.price,
                    rarity: wonItem.rarity,
                    from_case: wonItem.from_case,
                    won_at: wonItem.won_at
                };
            }

            saveAccount(account);
            return sendJson(res, 200, {
                ok: true,
                balance: account.balance,
                inventory: account.inventory,
                bestDrop: account.bestDrop || null,
                item: wonItem,
                sum,
                range: { min: minPrice, max: maxPrice },
                moneySpent: account.moneySpent || 0
            });
        } else if (action === "set_inventory") {
            account.inventory = Array.isArray(body.inventory) ? body.inventory : account.inventory;
        } else {
            return sendJson(res, 400, { error: "Неизвестное action" });
        }

        saveAccount(account);
        return sendJson(res, 200, {
            ok: true,
            balance: account.balance,
            inventory: account.inventory || [],
            bestDrop: account.bestDrop || null,
            openedCases: account.openedCases || 0,
            moneySpent: account.moneySpent || 0
        });
    } catch (error) {
        console.error("update account:", error.message);
        return sendJson(res, 500, { error: error.message || "Ошибка аккаунта" });
    }
}


function handleSteamStart(req, res) {
    const session = getSession(req, res, true);
    const state = crypto.randomBytes(24).toString("hex");
    const callbackUrl = `${BASE_URL}/auth/steam/return?state=${encodeURIComponent(state)}`;

    session.openidState = state;
    session.openidStartedAt = Date.now();

    const params = new URLSearchParams({
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": callbackUrl,
        "openid.realm": `${BASE_URL}/`,
        "openid.identity": OPENID_IDENTIFIER,
        "openid.claimed_id": OPENID_IDENTIFIER
    });

    return redirect(res, `${OPENID_ENDPOINT}?${params.toString()}`);
}

async function handleSteamReturn(req, res, requestUrl) {
    const session = getSession(req, res, false);
    const state = requestUrl.searchParams.get("state");

    if (!session || !state || state !== session.openidState) {
        return sendErrorPage(res, "Steam-авторизация не подтверждена", "Сессия или защитный state-параметр не совпали. Начните вход заново.");
    }

    delete session.openidState;

    if (Date.now() - Number(session.openidStartedAt || 0) > 10 * 60 * 1000) {
        return sendErrorPage(res, "Steam-авторизация устарела", "Повторите вход через Steam.");
    }

    if (requestUrl.searchParams.get("openid.mode") === "cancel") {
        return redirect(res, "/profile.html");
    }

    const expectedReturnTo = `${BASE_URL}/auth/steam/return?state=${encodeURIComponent(state)}`;
    const returnedTo = requestUrl.searchParams.get("openid.return_to");
    const claimedId = requestUrl.searchParams.get("openid.claimed_id");
    const identity = requestUrl.searchParams.get("openid.identity");
    const opEndpoint = requestUrl.searchParams.get("openid.op_endpoint");
    const nonce = requestUrl.searchParams.get("openid.response_nonce");

    if (returnedTo !== expectedReturnTo) {
        return sendErrorPage(res, "Некорректный адрес возврата", "Steam вернул неожиданный return_to.");
    }

    if (!isSteamOpenIdEndpoint(opEndpoint)) {
        return sendErrorPage(res, "Некорректный Steam endpoint", "Ответ получен не от ожидаемого OpenID endpoint.");
    }

    if (!claimedId || identity !== claimedId) {
        return sendErrorPage(res, "Некорректный SteamID", "В ответе Steam отсутствует подтверждённый идентификатор.");
    }

    const steamIdMatch = claimedId.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
    if (!steamIdMatch) {
        return sendErrorPage(res, "Некорректный SteamID", "Формат Steam Claimed ID не распознан.");
    }

    if (!nonce || usedNonces.has(nonce)) {
        return sendErrorPage(res, "Повторный ответ Steam", "Этот OpenID-ответ уже был использован или не содержит nonce.");
    }

    const verificationParams = new URLSearchParams();
    for (const [key, value] of requestUrl.searchParams.entries()) {
        if (key.startsWith("openid.")) {
            verificationParams.append(key, value);
        }
    }
    verificationParams.set("openid.mode", "check_authentication");

    let verificationText;
    try {
        verificationText = await fetchText(OPENID_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: verificationParams.toString()
        });
    } catch (error) {
        console.error("Steam OpenID verification failed:", error);
        return sendErrorPage(res, "Steam временно недоступен", "Не удалось проверить ответ Steam. Попробуйте ещё раз.");
    }

    if (!/^is_valid\s*:\s*true\s*$/m.test(verificationText)) {
        return sendErrorPage(res, "Steam не подтвердил вход", "OpenID verification вернул недействительный ответ.");
    }

    usedNonces.set(nonce, Date.now() + 10 * 60 * 1000);

    const steamId = steamIdMatch[1];
    const profile = await loadSteamProfile(steamId);
    const user = profile || {
        steamId,
        name: "Steam Player",
        avatar: "/images/avatar-placeholder.svg",
        profileUrl: `https://steamcommunity.com/profiles/${steamId}/`,
        personaState: 0,
        profileLoaded: false
    };

    rotateSession(req, res, user);
    return redirect(res, "/profile.html");
}

function handleLogout(req, res) {
    const cookies = parseCookies(req.headers.cookie || "");
    const sid = cookies[COOKIE_NAME];
    if (sid) sessions.delete(sid);

    clearSessionCookie(res);
    return redirect(res, "/");
}

async function loadSteamProfile(steamId) {
    const id = String(steamId || "").trim();
    if (!id) return null;

    // 1) Официальный Steam Web API (если ключ задан)
    if (STEAM_API_KEY) {
        try {
            const apiUrl = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`);
            apiUrl.searchParams.set("key", STEAM_API_KEY);
            apiUrl.searchParams.set("steamids", id);
            const body = await fetchJson(apiUrl.toString());
            const player = body && body.response && Array.isArray(body.response.players)
                ? body.response.players[0]
                : null;
            if (player && String(player.steamid) === id) {
                return {
                    steamId: id,
                    name: player.personaname || "Steam Player",
                    avatar: player.avatarfull || player.avatarmedium || player.avatar || "/images/avatar-placeholder.svg",
                    profileUrl: player.profileurl || `https://steamcommunity.com/profiles/${id}/`,
                    personaState: Number(player.personastate || 0),
                    profileLoaded: true
                };
            }
            console.warn("Steam API: профиль не найден для", id);
        } catch (error) {
            console.error("Steam GetPlayerSummaries failed:", error.message);
        }
    }

    // 2) Публичный XML steamcommunity — без API key
    try {
        const xmlUrl = `https://steamcommunity.com/profiles/${id}/?xml=1`;
        const res = await fetch(xmlUrl, {
            headers: {
                "Accept": "application/xml,text/xml,*/*",
                "User-Agent": "Mozilla/5.0 DOODROP"
            }
        });
        if (res.ok) {
            const xml = await res.text();
            const pick = (tag) => {
                const cdata = xml.match(new RegExp("<" + tag + "><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></" + tag + ">", "i"));
                if (cdata) return cdata[1].trim();
                const plain = xml.match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">", "i"));
                return plain ? plain[1].trim() : "";
            };
            const nick = pick("steamID");
            const avatar = pick("avatarFull") || pick("avatarMedium") || pick("avatarIcon");
            const onlineState = (pick("onlineState") || "").toLowerCase();
            if (nick || avatar) {
                return {
                    steamId: id,
                    name: nick || "Steam Player",
                    avatar: avatar || "/images/avatar-placeholder.svg",
                    profileUrl: `https://steamcommunity.com/profiles/${id}/`,
                    personaState: (onlineState === "online" || onlineState === "in-game") ? 1 : 0,
                    profileLoaded: true
                };
            }
        } else {
            console.warn("Steam XML status", res.status, "for", id);
        }
    } catch (error) {
        console.error("Steam XML profile failed:", error.message);
    }

    return null;
}

function getSession(req, res, create) {
    const cookies = parseCookies(req.headers.cookie || "");
    const sid = cookies[COOKIE_NAME];
    const existing = sid ? sessions.get(sid) : null;

    if (existing && existing.expiresAt > Date.now()) {
        return existing;
    }

    if (sid) sessions.delete(sid);
    if (!create) return null;

    const newSid = crypto.randomBytes(32).toString("base64url");
    const session = { expiresAt: Date.now() + SESSION_TTL_MS };
    sessions.set(newSid, session);
    setSessionCookie(res, newSid);
    return session;
}

function rotateSession(req, res, user) {
    const cookies = parseCookies(req.headers.cookie || "");
    const oldSid = cookies[COOKIE_NAME];
    if (oldSid) sessions.delete(oldSid);

    const newSid = crypto.randomBytes(32).toString("base64url");
    sessions.set(newSid, {
        user,
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    setSessionCookie(res, newSid);
}

function setSessionCookie(res, sid) {
    const secure = BASE_URL.startsWith("https://") ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

function clearSessionCookie(res) {
    const secure = BASE_URL.startsWith("https://") ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function parseCookies(cookieHeader) {
    const result = {};
    for (const part of cookieHeader.split(";")) {
        const index = part.indexOf("=");
        if (index === -1) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function cleanupExpiredData() {
    const now = Date.now();

    for (const [sid, session] of sessions.entries()) {
        if (session.expiresAt <= now) sessions.delete(sid);
    }

    for (const [nonce, expiresAt] of usedNonces.entries()) {
        if (expiresAt <= now) usedNonces.delete(nonce);
    }
}

function isSteamOpenIdEndpoint(value) {
    return value === "https://steamcommunity.com/openid/login" ||
        value === "https://steamcommunity.com/openid/";
}

function isInside(baseDirectory, candidate) {
    const relative = path.relative(baseDirectory, candidate);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendFile(res, filePath, headOnly = false) {
    fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
            return sendText(res, 404, "Файл не найден");
        }

        const extension = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader("Content-Type", mimeTypes[extension] || "application/octet-stream");
        res.setHeader("Content-Length", stats.size);

        if (headOnly) return res.end();

        const stream = fs.createReadStream(filePath);
        stream.on("error", () => sendText(res, 500, "Ошибка чтения файла"));
        stream.pipe(res);
    });
}

function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
}

function sendText(res, statusCode, text) {
    const body = String(text);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
}

function sendErrorPage(res, title, message) {
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const body = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;font-family:Arial,sans-serif;background:#0c1018;color:#fff;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,90%);padding:32px;border-radius:20px;background:#151c2b;border:1px solid rgba(255,255,255,.08)}h1{margin-top:0;color:#ffb400}p{color:#b8bfd0;line-height:1.55}a{display:inline-block;margin-top:15px;padding:13px 18px;border-radius:10px;background:#ffb400;color:#111;text-decoration:none;font-weight:700}</style></head><body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="/profile.html">Вернуться в профиль</a></div></body></html>`;
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
}

function redirect(res, location) {
    res.statusCode = 302;
    res.setHeader("Location", location);
    res.end();
}

function setSecurityHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchJson(url) {
    const text = await fetchText(url, {
        headers: { "Accept": "application/json" }
    });
    return JSON.parse(text);
}

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;

    const contents = fs.readFileSync(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const equalsIndex = line.indexOf("=");
        if (equalsIndex <= 0) continue;

        const key = line.slice(0, equalsIndex).trim();
        let value = line.slice(equalsIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) process.env[key] = value;
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
