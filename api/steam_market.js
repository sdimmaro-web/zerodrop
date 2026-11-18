// Steam / market helper for DOODROP
// Цена: CSGOTrader (Steam median USD) + конвертация в RUB
// Картинка: steamapis image redirect (без ключа)
// Только ТОЧНЫЙ market_hash_name — без подмены на StatTrak

const APP_ID = 730;
const IMAGE_ENDPOINT = "https://api.steamapis.com/image/item/730/";
const PRICES_URL = "https://prices.csgotrader.app/latest/steam.json";
const FX_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 15 * 60 * 1000;
const PRICES_TTL_MS = 30 * 60 * 1000;
const FX_TTL_MS = 60 * 60 * 1000;

const resultCache = new Map();
let pricesCache = { data: null, expiresAt: 0, loading: null };
let fxCache = { rate: 90, expiresAt: 0, loading: null };

const KNIFE_RE =
    /\b(knife|bayonet|karambit|daggers|shadow daggers|navaja|talon|ursus|stiletto|paracord|survival|nomad|skeleton|butterfly|huntsman|falchion|bowie|classic knife|kukri|gut knife|m9)\b/i;

function pickPrice(entry) {
    if (!entry || typeof entry !== "object") return 0;
    for (const key of ["last_24h", "last_7d", "last_30d", "last_90d"]) {
        const v = Number(entry[key]);
        if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
    }
    return 0;
}

function buildCandidates(input) {
    const raw = String(input || "").trim();
    if (!raw) return [];

    const wantsStat = /stat\s*trak/i.test(raw);
    const base = raw
        .replace(/^★\s*/, "")
        .replace(/stat\s*trak™?\s*/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    const list = [];
    const add = (v) => {
        const t = String(v || "").trim();
        if (t && !list.includes(t)) list.push(t);
    };

    // Сначала то, что ближе к запросу пользователя
    if (wantsStat) {
        add(raw);
        add("★ StatTrak™ " + base);
        add("StatTrak™ " + base);
        add("★ " + base);
        add(base);
    } else {
        add(raw);
        add("★ " + base);
        add(base);
        // StatTrak только в конце кандидатов (если обычного нет в базе)
        add("★ StatTrak™ " + base);
        add("StatTrak™ " + base);
    }

    if (KNIFE_RE.test(base)) {
        // ножи в маркете почти всегда со звездой
        if (wantsStat) {
            add("★ StatTrak™ " + base);
        } else {
            add("★ " + base);
        }
    }

    return list;
}

async function loadPrices() {
    if (pricesCache.data && pricesCache.expiresAt > Date.now()) {
        return pricesCache.data;
    }
    if (pricesCache.loading) return pricesCache.loading;

    pricesCache.loading = (async () => {
        const response = await fetch(PRICES_URL, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; DOODROP/1.1)"
            }
        });
        if (!response.ok) throw new Error("Не удалось загрузить прайс-лист (" + response.status + ")");
        const data = await response.json();
        if (!data || typeof data !== "object") throw new Error("Пустой прайс-лист");
        pricesCache = {
            data,
            expiresAt: Date.now() + PRICES_TTL_MS,
            loading: null
        };
        return data;
    })();

    try {
        return await pricesCache.loading;
    } catch (err) {
        pricesCache.loading = null;
        throw err;
    }
}

async function loadUsdRubRate() {
    if (fxCache.expiresAt > Date.now() && fxCache.rate > 0) return fxCache.rate;
    if (fxCache.loading) return fxCache.loading;

    fxCache.loading = (async () => {
        try {
            const response = await fetch(FX_URL, {
                headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; DOODROP/1.1)" }
            });
            if (!response.ok) throw new Error("fx http");
            const data = await response.json();
            const rate = Number(data?.rates?.RUB);
            if (Number.isFinite(rate) && rate > 1) {
                fxCache = { rate, expiresAt: Date.now() + FX_TTL_MS, loading: null };
                return rate;
            }
        } catch {
            // fallback
        }
        fxCache.loading = null;
        return fxCache.rate || 90;
    })();

    return fxCache.loading;
}

function buildImageUrl(marketHashName) {
    return IMAGE_ENDPOINT + encodeURIComponent(marketHashName);
}

function detectRarity(marketHashName) {
    if (/★/.test(marketHashName)) return "Covert";
    return "Unknown";
}

/**
 * @param {string} marketHashName
 */
async function getSkinInfo(marketHashName) {
    const name = String(marketHashName || "").trim();
    if (!name) throw new Error("Укажите market_hash_name скина");

    const cached = resultCache.get(name);
    if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.data, fromCache: true };
    }

    const wantsStat = /stat\s*trak/i.test(name);
    const candidates = buildCandidates(name);
    const prices = await loadPrices();
    const usdRub = await loadUsdRubRate();

    let matchedHash = null;
    let usd = 0;
    let priceEntry = null;

    for (const candidate of candidates) {
        if (!Object.prototype.hasOwnProperty.call(prices, candidate)) continue;

        // если пользователь НЕ просил StatTrak — пропускаем StatTrak-ключи,
        // пока не закончатся обычные варианты
        if (!wantsStat && /stat\s*trak/i.test(candidate)) continue;

        const entry = prices[candidate];
        const value = pickPrice(entry);
        if (value > 0 || entry) {
            matchedHash = candidate;
            usd = value;
            priceEntry = entry;
            break;
        }
    }

    // если обычного не нашли — разрешаем StatTrak как последний шанс (с пометкой)
    let forcedStatTrak = false;
    if (!matchedHash) {
        for (const candidate of candidates) {
            if (!Object.prototype.hasOwnProperty.call(prices, candidate)) continue;
            const entry = prices[candidate];
            const value = pickPrice(entry);
            matchedHash = candidate;
            usd = value;
            priceEntry = entry;
            forcedStatTrak = /stat\s*trak/i.test(candidate) && !wantsStat;
            break;
        }
    }

    if (!matchedHash) {
        throw new Error(
            "Скин не найден в прайсе. Проверьте точное название с износом. Для ножей обязательно ★, например: ★ Navaja Knife | Marble Fade (Factory New)"
        );
    }

    const priceRub = usd > 0 ? Math.round(usd * usdRub * 100) / 100 : 0;
    const displayName = matchedHash.replace(/\s*\([^)]+\)\s*$/, "").trim() || matchedHash;
    const image = buildImageUrl(matchedHash);

    const warnings = [];
    if (forcedStatTrak) {
        warnings.push("Обычная версия не найдена — показан StatTrak. Добавьте ★ и без StatTrak™ в запрос.");
    }
    if (usd <= 0) {
        warnings.push("В прайсе нет свежей цены по этому предмету.");
    }
    if (matchedHash !== name && normalizeLoose(matchedHash) !== normalizeLoose(name)) {
        warnings.push("Найдено ближайшее точное имя: " + matchedHash);
    }

    const result = {
        name: displayName,
        market_hash_name: matchedHash,
        image,
        image_large: image,
        icon_url: "",
        price: priceRub,
        price_text: priceRub > 0 ? priceRub.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽" : null,
        price_usd: usd,
        price_usd_text: usd > 0 ? "$" + usd.toFixed(2) : null,
        median_price: priceRub,
        median_price_text: priceEntry?.last_7d != null ? String(priceEntry.last_7d) : null,
        volume: null,
        listings: null,
        rarity: detectRarity(matchedHash),
        type: "",
        name_color: /★/.test(matchedHash) ? "#8650AC" : null,
        currency: "RUB",
        usd_rub_rate: usdRub,
        warning: warnings.length ? warnings.join(" ") : undefined,
        source: "csgotrader/steam",
        api_version: "doodrop-market-2",
        updated_at: new Date().toISOString()
    };

    resultCache.set(name, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    resultCache.set(matchedHash, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
}

function normalizeLoose(value) {
    return String(value || "")
        .replace(/★/g, "")
        .replace(/stat\s*trak™?/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

async function getManySkinInfos(names, delayMs = 50) {
    // прайс уже одним файлом — задержки почти не нужны
    await loadPrices();
    const out = [];
    for (const n of names) {
        try {
            out.push(await getSkinInfo(n));
        } catch (err) {
            out.push({ market_hash_name: n, error: err.message });
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    return out;
}

module.exports = {
    getSkinInfo,
    getManySkinInfos,
    buildCandidates,
    buildImageUrl
};
