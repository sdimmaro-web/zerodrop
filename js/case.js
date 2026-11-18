(() => {
    const params = new URLSearchParams(location.search);
    const id = Number(params.get("id") || 0);

    const titleEl = document.getElementById("title");
    const priceEl = document.getElementById("price");
    const itemsEl = document.getElementById("items");
    const openBtn = document.getElementById("open");
    const resultEl = document.getElementById("result");
    const caseImageEl = document.getElementById("caseImage");
    const stackEl = document.getElementById("rouletteStack");
    const multiEl = document.getElementById("multiResults");
    const totalPriceEl = document.getElementById("totalPrice");

    let caseData = null;
    let busy = false;
    let qty = 1;
    let lastDrops = []; // предметы с id с сервера после открытия

    function money(n) {
        return Number(n || 0).toLocaleString("ru-RU") + " ₽";
    }

    function rarityClass(r) {
        const x = String(r || "").toLowerCase();
        if (x.includes("legend") || x.includes("covert")) return "legendary";
        if (x.includes("epic") || x.includes("class")) return "epic";
        if (x.includes("rare") || x.includes("restrict")) return "rare";
        if (x.includes("uncommon") || x.includes("mil")) return "uncommon";
        return "common";
    }

    // максимальная цена дропа = цена кейса × 1.5
    const DROP_MAX_MULT = 1.5;

    function normalizeItems(rawItems) {
        if (!Array.isArray(rawItems) || !rawItems.length) {
            return [{ name: "Пустой слот", image: "", price: 0, rarity: "common" }];
        }
        return rawItems.map((it) => {
            if (typeof it === "string") {
                return { name: it, image: "", price: 0, rarity: "common" };
            }
            return {
                name: it.name || it.market_hash_name || "Скин",
                market_hash_name: it.market_hash_name || "",
                image: it.image || it.image_large || "",
                price: Number(it.price) || 0,
                rarity: it.rarity || "common"
            };
        });
    }

    /** Пул предметов, которые реально могут выпасть (цена ≤ цена_кейса × 1.5) */
    function getDropPool() {
        const all = (caseData && caseData.items) || [];
        const casePrice = Number(caseData && caseData.price) || 0;
        if (!all.length) return all;
        if (casePrice <= 0) return all;
        const maxDrop = casePrice * DROP_MAX_MULT;
        let pool = all.filter((it) => (Number(it.price) || 0) <= maxDrop && (Number(it.price) || 0) > 0);
        // если в диапазоне никого нет — берём самые дешёвые из кейса
        if (!pool.length) {
            const sorted = all.slice().sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
            pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.3)));
        }
        return pool;
    }

    function pickDrop() {
        const pool = getDropPool();
        if (!pool.length) return { name: "Пустой слот", image: "", price: 0, rarity: "common" };
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function renderContents(items) {
        itemsEl.innerHTML = items.map((it) => `
            <div class="content-item ${rarityClass(it.rarity)}">
                ${it.image ? `<img src="${it.image}" alt="" onerror="this.style.display='none'">` : `<div style="height:110px"></div>`}
                <div class="n">${it.name}</div>
                <div class="p">${it.price ? money(it.price) : "—"}</div>
            </div>
        `).join("");
    }

    function updateQtyUI() {
        document.querySelectorAll(".qty-btn").forEach((b) => {
            b.classList.toggle("active", Number(b.dataset.qty) === qty);
        });
        if (openBtn) openBtn.textContent = "ОТКРЫТЬ x" + qty;
        const unit = Number(caseData && caseData.price) || 0;
        if (totalPriceEl) totalPriceEl.textContent = money(unit * qty);
        rebuildRoulettes();
    }

    function rebuildRoulettes() {
        if (!stackEl || !caseData) return;
        // на ленте показываем ВСЕ предметы кейса (включая дорогие) — они «пролетают»
        const visual = caseData.items || [];
        if (!visual.length) return;
        stackEl.innerHTML = "";
        for (let i = 0; i < qty; i++) {
            const wrap = document.createElement("div");
            wrap.className = "roulette-wrap";
            const roll = document.createElement("div");
            roll.className = "roll";
            roll.dataset.roll = String(i);
            const arr = [];
            for (let k = 0; k < 40; k++) arr.push(visual[Math.floor(Math.random() * visual.length)]);
            roll.innerHTML = arr.map((it) => `
                <div class="roll-card ${rarityClass(it.rarity)}">
                    ${it.image ? `<img src="${it.image}" alt="" onerror="this.style.opacity=0.2">` : ""}
                    <span>${it.name}</span>
                </div>
            `).join("");
            wrap.appendChild(roll);
            stackEl.appendChild(wrap);
        }
    }

    function spinOne(rollEl, win, durationMs, delayMs) {
        return new Promise((resolve) => {
            // лента: все скины кейса мелькают, но на финише только реальный дроп (≤1.5×)
            const visual = caseData.items || [];
            const strip = [];
            for (let i = 0; i < 40; i++) {
                strip.push(visual.length ? visual[Math.floor(Math.random() * visual.length)] : win);
            }
            const winIndex = 32;
            strip[winIndex] = win;

            rollEl.style.transition = "none";
            rollEl.style.transform = "translateX(0)";
            rollEl.innerHTML = strip.map((it) => `
                <div class="roll-card ${rarityClass(it.rarity)}">
                    ${it.image ? `<img src="${it.image}" alt="" onerror="this.style.opacity=0.2">` : ""}
                    <span>${it.name}</span>
                </div>
            `).join("");

            const cardStep = 142;
            const offset = winIndex * cardStep + 65;

            setTimeout(() => {
                requestAnimationFrame(() => {
                    rollEl.style.transition = `transform ${durationMs}ms cubic-bezier(.12,.7,.1,1)`;
                    rollEl.style.transform = `translateX(-${offset}px)`;
                });
                setTimeout(resolve, durationMs + 80);
            }, delayMs);
        });
    }

    async function loadCase() {
        try {
            const res = await fetch("/api/cases", { cache: "no-store" });
            const data = await res.json();
            const list = data.cases || [];
            caseData = list.find((c) => Number(c.id) === id) || list[0] || null;
        } catch {
            caseData = null;
        }

        if (!caseData) {
            titleEl.textContent = "Кейс не найден";
            openBtn.disabled = true;
            return;
        }

        caseData.items = normalizeItems(caseData.items);
        titleEl.textContent = caseData.name;
        priceEl.textContent = money(caseData.price);
        if (caseData.image) caseImageEl.src = caseData.image;
        renderContents(caseData.items);
        updateQtyUI();
    }

    document.getElementById("qtyRow")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".qty-btn");
        if (!btn || busy) return;
        qty = Number(btn.dataset.qty) || 1;
        hideSellUI();
        multiEl.classList.remove("show");
        multiEl.innerHTML = "";
        resultEl.textContent = "";
        updateQtyUI();
    });

    function hideSellUI() {
        lastDrops = [];
        const bar = document.getElementById("sellBar");
        if (bar) bar.classList.remove("show");
        const sellAll = document.getElementById("sellAllBtn");
        if (sellAll) {
            sellAll.disabled = false;
            sellAll.textContent = "Продать всё";
        }
    }

    function showSellUI(drops) {
        lastDrops = (drops || []).filter((d) => d && d.id);
        multiEl.innerHTML = lastDrops
            .map(
                (win) => `
            <div class="multi-card ${rarityClass(win.rarity)}" data-id="${win.id}">
                ${win.image ? `<img src="${win.image}" alt="">` : ""}
                <div class="n">${win.name || "Скин"}</div>
                <div class="p">${win.price ? money(win.price) : "—"}</div>
                <button type="button" class="btn-sell-one" data-id="${win.id}">Продать · ${money(win.price)}</button>
            </div>`
            )
            .join("");
        multiEl.classList.add("show");

        const sum = lastDrops.reduce((s, w) => s + (Number(w.price) || 0), 0);
        const bar = document.getElementById("sellBar");
        const sellAll = document.getElementById("sellAllBtn");
        if (sellAll) {
            sellAll.disabled = !lastDrops.length;
            sellAll.textContent = lastDrops.length > 1 ? "Продать всё · " + money(sum) : "Продать · " + money(sum);
        }
        if (bar) bar.classList.add("show");
    }

    async function sellOne(itemId, card) {
        if (!itemId || !window.DoodropInventory) return;
        const btn = card?.querySelector(".btn-sell-one");
        if (btn) btn.disabled = true;
        try {
            const data = await window.DoodropInventory.sell(itemId);
            if (card) card.classList.add("sold");
            lastDrops = lastDrops.filter((d) => String(d.id) !== String(itemId));
            const sum = lastDrops.reduce((s, w) => s + (Number(w.price) || 0), 0);
            const sellAll = document.getElementById("sellAllBtn");
            if (sellAll) {
                if (!lastDrops.length) {
                    sellAll.disabled = true;
                    sellAll.textContent = "Всё продано";
                    resultEl.textContent = "Продано · +" + money(data.soldTotal || data.sold?.price || 0);
                } else {
                    sellAll.textContent =
                        lastDrops.length > 1 ? "Продать всё · " + money(sum) : "Продать · " + money(sum);
                }
            }
        } catch (err) {
            if (btn) btn.disabled = false;
            resultEl.textContent = err.message || "Ошибка продажи";
        }
    }

    async function sellAll() {
        if (!lastDrops.length || !window.DoodropInventory) return;
        const sellAllBtn = document.getElementById("sellAllBtn");
        if (sellAllBtn) sellAllBtn.disabled = true;
        const ids = lastDrops.map((d) => d.id);
        try {
            const data = await (window.DoodropInventory.sellMany
                ? window.DoodropInventory.sellMany(ids)
                : Promise.all(ids.map((id) => window.DoodropInventory.sell(id))).then(() => ({ soldTotal: 0 })));
            multiEl.querySelectorAll(".multi-card").forEach((c) => c.classList.add("sold"));
            const total = data.soldTotal || lastDrops.reduce((s, w) => s + (Number(w.price) || 0), 0);
            lastDrops = [];
            if (sellAllBtn) sellAllBtn.textContent = "Всё продано";
            resultEl.textContent = "Продано всё · +" + money(total);
        } catch (err) {
            if (sellAllBtn) sellAllBtn.disabled = false;
            resultEl.textContent = err.message || "Ошибка продажи";
        }
    }

    openBtn.addEventListener("click", async () => {
        if (busy) return;
        if (!caseData || !Array.isArray(caseData.items) || !caseData.items.length) {
            resultEl.textContent = "В кейсе нет предметов";
            return;
        }

        if (!window.DoodropAuth || !window.DoodropAuth.isAuthenticated()) {
            const user = window.DoodropAuth ? await window.DoodropAuth.loadUser() : null;
            if (!user) {
                resultEl.textContent = "Войдите через Steam, чтобы открывать кейсы";
                if (confirm("Для открытия кейсов нужен вход через Steam. Войти сейчас?")) {
                    location.href = "/auth/steam";
                }
                return;
            }
        }

        const unitPrice = Number(caseData.price) || 0;
        const total = unitPrice * qty;
        const bal = window.DoodropBalance ? window.DoodropBalance.get() : 0;
        if (bal < total) {
            resultEl.textContent = "Недостаточно средств (нужно " + money(total) + ", есть " + money(bal) + ")";
            return;
        }

        busy = true;
        openBtn.disabled = true;
        document.querySelectorAll(".qty-btn").forEach((b) => (b.disabled = true));
        hideSellUI();
        multiEl.classList.remove("show");
        multiEl.innerHTML = "";
        resultEl.textContent = qty > 1 ? "Открываем x" + qty + "..." : "Открываем...";

        // роллы: только предметы ≤ цена_кейса × 1.5
        const wins = [];
        for (let i = 0; i < qty; i++) {
            wins.push(pickDrop());
        }

        // сервер: списать total и добавить все предметы одним запросом
        let serverItems = [];
        try {
            if (window.DoodropAccount) {
                const data = await window.DoodropAccount.openCase({
                    price: total,
                    count: qty,
                    case_price: unitPrice,
                    items: wins.map((win) => ({
                        name: win.name,
                        market_hash_name: win.market_hash_name || "",
                        image: win.image || "",
                        price: win.price || 0,
                        rarity: win.rarity || "Unknown",
                        from_case: caseData.name || ""
                    })),
                    item: {
                        name: wins[0].name,
                        market_hash_name: wins[0].market_hash_name || "",
                        image: wins[0].image || "",
                        price: wins[0].price || 0,
                        rarity: wins[0].rarity || "Unknown",
                        from_case: caseData.name || ""
                    },
                    caseName: caseData.name || ""
                });
                // предметы с id с сервера (для продажи)
                if (Array.isArray(data.items) && data.items.length) {
                    serverItems = data.items;
                } else if (data.item) {
                    serverItems = [data.item];
                }
            }
        } catch (err) {
            busy = false;
            openBtn.disabled = false;
            document.querySelectorAll(".qty-btn").forEach((b) => (b.disabled = false));
            if (String(err.message) === "AUTH_REQUIRED") {
                resultEl.textContent = "Войдите через Steam";
                location.href = "/auth/steam";
                return;
            }
            resultEl.textContent = err.message || "Ошибка открытия";
            return;
        }

        // анимации всех рулеток параллельно
        const rolls = [...stackEl.querySelectorAll(".roll")];
        const duration = qty >= 5 ? 3200 : 4000;
        const anims = rolls.map((rollEl, i) =>
            spinOne(rollEl, wins[i], duration, i * 120)
        );
        await Promise.all(anims);

        // результаты + кнопки продажи
        const drops = serverItems.length ? serverItems : wins;
        const sum = drops.reduce((s, w) => s + (Number(w.price) || 0), 0);
        if (qty === 1) {
            const win = drops[0] || wins[0];
            resultEl.textContent = "Вы получили: " + (win.name || "Скин") + (win.price ? " · " + money(win.price) : "");
        } else {
            resultEl.textContent = "Открыто x" + qty + " · сумма дропа " + money(sum);
        }
        showSellUI(drops);

        busy = false;
        openBtn.disabled = false;
        document.querySelectorAll(".qty-btn").forEach((b) => (b.disabled = false));
    });

    document.getElementById("multiResults")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-sell-one");
        if (!btn || btn.disabled) return;
        const card = btn.closest(".multi-card");
        sellOne(btn.getAttribute("data-id"), card);
    });
    document.getElementById("sellAllBtn")?.addEventListener("click", sellAll);
    document.getElementById("keepBtn")?.addEventListener("click", () => {
        hideSellUI();
        multiEl.classList.remove("show");
        multiEl.innerHTML = "";
        resultEl.textContent = "Предметы оставлены в инвентаре";
    });

    document.addEventListener("DOMContentLoaded", loadCase);
    if (document.readyState !== "loading") loadCase();
})();
