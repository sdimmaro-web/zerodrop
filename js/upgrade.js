(() => {
    let inventory = [];
    let catalog = [];
    let selectedInput = null;
    let selectedTarget = null;
    let balanceAdd = 0;
    let busy = false;
    let userBalance = 0;
    let lastNeedleDeg = 0; // куда остановилась стрелка
    let freezeChance = null; // шанс во время/после спина (зелёная зона не пропадает)

    const money = (n) => Number(n || 0).toLocaleString("ru-RU") + " ₽";

    const MAX_CHANCE = 75; // потолок шанса апгрейда

    function calcChance() {
        if (!selectedInput || !selectedTarget) return 0;
        const inputVal = Number(selectedInput.price) || 0;
        const targetVal = Number(selectedTarget.price) || 0;
        if (targetVal <= 0) return 0;
        const total = inputVal + balanceAdd;
        // базовый шанс: вклад / цена цели, максимум 75%
        let ch = (total / targetVal) * 100;
        if (ch > MAX_CHANCE) ch = MAX_CHANCE;
        if (ch < 0) ch = 0;
        return Math.round(ch * 100) / 100;
    }

    function clearResultOverlay() {
        const resultEl = document.getElementById("chanceResult");
        if (resultEl) {
            resultEl.className = "chance-result";
            resultEl.textContent = "";
        }
    }

    function resetNeedle() {
        lastNeedleDeg = 0;
        freezeChance = null;
        const needle = document.getElementById("chanceNeedle");
        if (needle) {
            needle.style.transition = "none";
            needle.style.transform = "rotate(0deg)";
        }
        const wrap = document.getElementById("chanceWrap");
        if (wrap) wrap.classList.remove("is-spinning");
    }

    /**
     * SVG-кольцо:
     * цветная дуга (зелёный→жёлтый→оранжевый→красный) = ПОБЕДА
     * серая часть = ПРОИГРЫШ
     * длина цветной дуги = шанс %
     * r=42 → длина окружности ≈ 263.89
     */
    function setDialGradient(ch) {
        const ring = document.getElementById("ringWin");
        if (!ring) return;
        const c = Math.max(0, Math.min(100, Number(ch) || 0));
        const C = 2 * Math.PI * 42;
        const winLen = (c / 100) * C;
        const rest = Math.max(0, C - winLen);
        ring.setAttribute("stroke-dasharray", winLen.toFixed(2) + " " + rest.toFixed(2));
    }

    function updateChanceUI() {
        const chLive = calcChance();
        const ch = freezeChance != null ? freezeChance : chLive;
        const val = document.getElementById("chanceValue");
        const label = document.getElementById("chanceLabel");
        setDialGradient(ch);
        if (val && !busy && freezeChance == null) {
            val.textContent = chLive.toFixed(2).replace(".", ",") + "%";
            val.style.color = "#ffb400";
        }
        if (label && !busy && freezeChance == null) {
            if (chLive >= 70) label.textContent = "высокий шанс";
            else if (chLive >= 40) label.textContent = "средний шанс";
            else if (chLive > 0) label.textContent = "низкий шанс";
            else label.textContent = "шанс";
        }
        // стрелку НЕ сбрасываем — она остаётся в зоне win/lose
        const btn = document.getElementById("upgradeBtn");
        if (btn) btn.disabled = busy || !selectedInput || !selectedTarget || chLive <= 0;

        document.querySelectorAll(".chance-presets button[data-chance]").forEach((b) => {
            const want = Number(b.dataset.chance);
            b.classList.toggle("active", freezeChance == null && Math.abs(chLive - want) < 0.6);
        });
    }

    function renderInput() {
        const ph = document.getElementById("inputPlaceholder");
        const prev = document.getElementById("inputPreview");
        const clear = document.getElementById("clearInput");
        if (!selectedInput) {
            if (ph) ph.hidden = false;
            if (prev) prev.hidden = true;
            if (clear) clear.hidden = true;
            return;
        }
        if (ph) ph.hidden = true;
        if (prev) prev.hidden = false;
        if (clear) clear.hidden = false;
        document.getElementById("inputImg").src = selectedInput.image || "";
        document.getElementById("inputName").textContent = selectedInput.name || "Скин";
        document.getElementById("inputPrice").textContent = money(selectedInput.price);
    }

    function renderTarget() {
        const ph = document.getElementById("targetPlaceholder");
        const prev = document.getElementById("targetPreview");
        const clear = document.getElementById("clearTarget");
        if (!selectedTarget) {
            if (ph) ph.hidden = false;
            if (prev) prev.hidden = true;
            if (clear) clear.hidden = true;
            updateBalanceSlider();
            updateChanceUI();
            return;
        }
        if (ph) ph.hidden = true;
        if (prev) prev.hidden = false;
        if (clear) clear.hidden = false;
        document.getElementById("targetImg").src = selectedTarget.image || "";
        document.getElementById("targetName").textContent = selectedTarget.name || "Скин";
        document.getElementById("targetPrice").textContent = money(selectedTarget.price);
        updateBalanceSlider();
        updateChanceUI();
    }

    function updateBalanceSlider() {
        const range = document.getElementById("balanceAdd");
        const valEl = document.getElementById("balanceAddVal");
        if (!range) return;
        // максимум дописки баланса: только до 75% шанса (и не больше реального баланса)
        let maxByChance = Math.floor(userBalance);
        if (selectedInput && selectedTarget) {
            const inputVal = Number(selectedInput.price) || 0;
            const targetVal = Number(selectedTarget.price) || 0;
            if (targetVal > 0) {
                // (input + add) / target * 100 = 75  =>  add = target*0.75 - input
                const needForMax = Math.ceil(targetVal * (MAX_CHANCE / 100) - inputVal);
                maxByChance = Math.max(0, Math.min(Math.floor(userBalance), needForMax));
            }
        } else {
            maxByChance = 0;
        }
        const max = Math.max(0, maxByChance);
        range.max = String(max);
        if (balanceAdd > max) balanceAdd = max;
        if (balanceAdd < 0) balanceAdd = 0;
        range.value = String(Math.round(balanceAdd));
        if (valEl) valEl.textContent = money(balanceAdd);
        range.disabled = max <= 0;
    }

    function renderInventory() {
        const grid = document.getElementById("myItems");
        const count = document.getElementById("invCount");
        if (count) count.textContent = inventory.length + " шт.";
        if (!grid) return;
        if (!inventory.length) {
            grid.innerHTML = '<p class="empty-hint">Инвентарь пуст. Откройте кейс, чтобы получить скины для апгрейда.</p>';
            return;
        }
        // сортировка по цене: от дорогих к дешёвым
        const sorted = inventory.slice().sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
        grid.innerHTML = sorted
            .map((it) => {
                const sel = selectedInput && String(selectedInput.id) === String(it.id) ? " selected" : "";
                return `<div class="skin-card${sel}" data-id="${it.id}">
                    <img src="${it.image || ""}" alt="" onerror="this.style.opacity=0.3">
                    <div class="n">${it.name || "Скин"}</div>
                    <div class="p">${money(it.price)}</div>
                </div>`;
            })
            .join("");
    }

    function renderCatalog(filter = "") {
        const grid = document.getElementById("targetItems");
        if (!grid) return;
        const q = filter.trim().toLowerCase();
        let list = catalog;
        if (q) {
            list = catalog.filter(
                (it) =>
                    String(it.name || "").toLowerCase().includes(q) ||
                    String(it.market_hash_name || "").toLowerCase().includes(q)
            );
        }
        // дороже выбранного входа — иначе апгрейд бессмысленен
        if (selectedInput) {
            const minP = (Number(selectedInput.price) || 0) * 1.05;
            list = list.filter((it) => (Number(it.price) || 0) >= minP);
        }
        list = list.slice(0, 120);
        if (!list.length) {
            grid.innerHTML = '<p class="empty-hint">Ничего не найдено</p>';
            return;
        }
        grid.innerHTML = list
            .map((it, idx) => {
                const key = it.market_hash_name || it.name + "_" + idx;
                const sel =
                    selectedTarget &&
                    (selectedTarget.market_hash_name || selectedTarget.name) ===
                        (it.market_hash_name || it.name)
                        ? " selected"
                        : "";
                return `<div class="skin-card${sel}" data-idx="${idx}" data-key="${encodeURIComponent(key)}">
                    <img src="${it.image || ""}" alt="" onerror="this.style.opacity=0.3">
                    <div class="n">${it.name || "Скин"}</div>
                    <div class="p">${money(it.price)}</div>
                </div>`;
            })
            .join("");
        // bind keys for selection via filtered list
        grid.querySelectorAll(".skin-card").forEach((card, i) => {
            card.addEventListener("click", () => {
                selectedTarget = list[i];
                clearResultOverlay();
                resetNeedle();
                renderTarget();
                renderCatalog(document.getElementById("targetSearch")?.value || "");
            });
        });
    }

    async function loadData() {
        const auth = window.DoodropAuth;
        const user = auth ? await auth.loadUser(true) : null;
        if (user) {
            inventory = Array.isArray(user.inventory) ? user.inventory.slice() : [];
            userBalance = Number(user.balance) || 0;
            if (window.DoodropBalance) window.DoodropBalance.paint(userBalance);
        } else {
            inventory = [];
            userBalance = 0;
        }
        renderInventory();

        try {
            const map = new Map();
            const addItem = (it) => {
                const key = it.market_hash_name || it.name;
                if (!key) return;
                const price = Number(it.price) || 0;
                if (price <= 0) return;
                if (!map.has(key) || price > (map.get(key).price || 0)) {
                    map.set(key, {
                        name: it.name || it.market_hash_name,
                        market_hash_name: it.market_hash_name || "",
                        image: it.image || "",
                        price,
                        rarity: it.rarity || "Unknown"
                    });
                }
            };
            // каталог из кейсов
            try {
                const res = await fetch("/api/cases", { cache: "no-store" });
                const data = await res.json();
                for (const c of data.cases || []) {
                    for (const it of c.items || []) addItem(it);
                }
            } catch (_) {}
            // полный каталог скинов (для точного подбора по %)
            try {
                const res2 = await fetch("/api/skins", { cache: "no-store" });
                const data2 = await res2.json();
                for (const it of data2.skins || []) addItem(it);
            } catch (_) {}
            catalog = Array.from(map.values()).sort((a, b) => b.price - a.price);
        } catch {
            catalog = [];
        }
        renderCatalog();
        updateChanceUI();
    }

    async function doUpgrade() {
        if (busy || !selectedInput || !selectedTarget) return;
        const ch = calcChance();
        if (ch <= 0) return;

        if (!window.DoodropAuth || !window.DoodropAuth.isAuthenticated()) {
            const user = window.DoodropAuth ? await window.DoodropAuth.loadUser() : null;
            if (!user) {
                alert("Войдите через Steam, чтобы апгрейдить");
                location.href = "/auth/steam";
                return;
            }
        }

        if (balanceAdd > userBalance) {
            document.getElementById("upgradeMsg").textContent = "Недостаточно баланса";
            return;
        }

        busy = true;
        document.getElementById("upgradeBtn").disabled = true;
        document.getElementById("upgradeMsg").textContent = "Прокачиваем...";
        const resultEl = document.getElementById("chanceResult");
        resultEl.className = "chance-result";
        resultEl.textContent = "";

        try {
            const res = await fetch("/api/account", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    action: "upgrade",
                    input_item_id: selectedInput.id,
                    balance_add: balanceAdd,
                    target: {
                        name: selectedTarget.name,
                        market_hash_name: selectedTarget.market_hash_name || "",
                        image: selectedTarget.image || "",
                        price: selectedTarget.price || 0,
                        rarity: selectedTarget.rarity || "Unknown"
                    },
                    chance: ch
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Ошибка апгрейда");

            userBalance = data.balance;
            inventory = data.inventory || [];
            if (window.DoodropBalance) window.DoodropBalance.paint(userBalance);

            // заморозить цветную (победную) зону на время результата
            freezeChance = ch;
            setDialGradient(ch);
            await spinDial(ch, data.won);

            if (data.won) {
                resultEl.className = "chance-result win";
                resultEl.textContent = "ПОБЕДА!\nВы выиграли";
                document.getElementById("upgradeMsg").textContent =
                    "Вы получили: " + (data.item?.name || selectedTarget.name);
            } else {
                resultEl.className = "chance-result lose";
                resultEl.textContent = "ЭХ...\nпопробуем ещё";
                document.getElementById("upgradeMsg").textContent = "Не повезло. Предмет списан.";
            }

            selectedInput = null;
            balanceAdd = 0;
            renderInput();
            renderInventory();
            updateBalanceSlider();
            updateChanceUI();
        } catch (err) {
            document.getElementById("upgradeMsg").textContent = err.message || "Ошибка";
        } finally {
            busy = false;
            updateChanceUI();
        }
    }

    /**
     * Крутится СТРЕЛКА. Круг стоит.
     * Цветная зона (зелёный→жёлтый→оранжевый→красный, 0° → chance%) = ПОБЕДА.
     * Серая зона (chance% → 360°) = ПРОИГРЫШ.
     * 0° = верх круга, дальше по часовой.
     */
    function spinDial(chance, won) {
        return new Promise((resolve) => {
            const needle = document.getElementById("chanceNeedle");
            const wrap = document.getElementById("chanceWrap");
            const chanceVal = document.getElementById("chanceValue");
            if (!needle) {
                resolve();
                return;
            }

            // зафиксировать градиент на время спина
            setDialGradient(chance);

            if (chanceVal) {
                chanceVal.textContent = chance.toFixed(2).replace(".", ",") + "%";
                chanceVal.style.color = "#ffb400";
            }

            // цветная (победная) зона: 0° → chanceDeg
            // серая (проигрыш): chanceDeg → 360°
            const chanceDeg = Math.max(2, Math.min(MAX_CHANCE, Number(chance) || 0)) * 3.6;
            let landDeg;
            if (won) {
                // внутри цветной дуги, отступ от границ
                const pad = Math.max(8, Math.min(22, chanceDeg * 0.22));
                const span = Math.max(4, chanceDeg - pad * 2);
                landDeg = pad + Math.random() * span;
            } else {
                // глубоко в серой зоне
                const loseStart = chanceDeg;
                const loseSpan = Math.max(4, 360 - chanceDeg);
                const pad = Math.max(18, Math.min(40, loseSpan * 0.22));
                const span = Math.max(4, loseSpan - pad * 2);
                landDeg = loseStart + pad + Math.random() * span;
            }
            // жёсткая страховка зон
            if (won) {
                landDeg = Math.min(Math.max(landDeg, 3), Math.max(4, chanceDeg - 3));
            } else {
                landDeg = Math.min(Math.max(landDeg, chanceDeg + 5), 357);
            }

            const fullSpins = 5 + Math.floor(Math.random() * 3);
            const totalDeg = fullSpins * 360 + landDeg;

            if (wrap) wrap.classList.add("is-spinning");
            needle.style.transition = "none";
            needle.style.transform = "rotate(0deg)";
            void needle.offsetWidth;

            const durationMs = 4200;
            needle.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.75, 0.08, 1)`;
            needle.style.transform = `rotate(${totalDeg}deg)`;

            setTimeout(() => {
                needle.style.transition = "none";
                needle.style.transform = `rotate(${landDeg}deg)`;
                lastNeedleDeg = landDeg;
                if (chanceVal) {
                    chanceVal.style.color = won ? "#6dff9a" : "#ff8a8a";
                }
                if (wrap) wrap.classList.remove("is-spinning");
                setTimeout(resolve, 400);
            }, durationMs + 40);
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("myItems")?.addEventListener("click", (e) => {
            const card = e.target.closest(".skin-card");
            if (!card) return;
            const id = card.getAttribute("data-id");
            selectedInput = inventory.find((x) => String(x.id) === String(id)) || null;
            balanceAdd = 0;
            clearResultOverlay();
            resetNeedle();
            renderInput();
            renderInventory();
            renderCatalog(document.getElementById("targetSearch")?.value || "");
            updateBalanceSlider();
            updateChanceUI();
        });

        document.getElementById("clearInput")?.addEventListener("click", () => {
            selectedInput = null;
            balanceAdd = 0;
            clearResultOverlay();
            resetNeedle();
            renderInput();
            renderInventory();
            renderCatalog(document.getElementById("targetSearch")?.value || "");
            updateChanceUI();
        });

        document.getElementById("clearTarget")?.addEventListener("click", () => {
            selectedTarget = null;
            clearResultOverlay();
            resetNeedle();
            renderTarget();
            renderCatalog(document.getElementById("targetSearch")?.value || "");
        });

        document.getElementById("balanceAdd")?.addEventListener("input", (e) => {
            balanceAdd = Number(e.target.value) || 0;
            document.getElementById("balanceAddVal").textContent = money(balanceAdd);
            updateChanceUI();
        });

        document.querySelectorAll(".chance-presets button").forEach((btn) => {
            btn.addEventListener("click", () => {
                const msg = document.getElementById("upgradeMsg");
                if (!selectedInput) {
                    if (msg) msg.textContent = "Сначала выберите предмет из инвентаря";
                    return;
                }
                if (busy) return;

                const inputVal = Number(selectedInput.price) || 0;
                if (inputVal <= 0) {
                    if (msg) msg.textContent = "У предмета нет цены";
                    return;
                }

                // Кнопки 25/50/75% и x2/x5 подбирают ЦЕЛЬ из каталога, а не докидывают баланс
                balanceAdd = 0;
                let desiredPrice = 0;
                let label = "";

                if (btn.dataset.chance) {
                    const wantPct = Math.max(1, Math.min(MAX_CHANCE, Number(btn.dataset.chance) || 50));
                    // шанс ≈ input / target * 100  =>  target ≈ input * 100 / wantPct
                    desiredPrice = (inputVal * 100) / wantPct;
                    label = wantPct + "%";
                } else if (btn.dataset.mult) {
                    const mult = Math.max(1.1, Number(btn.dataset.mult) || 2);
                    desiredPrice = inputVal * mult;
                    label = "×" + mult;
                } else {
                    return;
                }

                // цель должна быть дороже входного
                const minPrice = inputVal * 1.01;
                const candidates = catalog.filter((s) => (Number(s.price) || 0) > minPrice);
                if (!candidates.length) {
                    if (msg) msg.textContent = "В каталоге нет предметов дороже выбранного";
                    return;
                }

                // ищем ближайший по цене к desiredPrice
                let best = candidates[0];
                let bestDist = Math.abs((Number(best.price) || 0) - desiredPrice);
                for (const s of candidates) {
                    const p = Number(s.price) || 0;
                    const d = Math.abs(p - desiredPrice);
                    if (d < bestDist) {
                        best = s;
                        bestDist = d;
                    }
                }

                selectedTarget = best;
                clearResultOverlay();
                resetNeedle();
                renderTarget();
                renderCatalog(document.getElementById("targetSearch")?.value || "");
                updateBalanceSlider();
                updateChanceUI();

                // подсветить выбранную карточку в каталоге
                const grid = document.getElementById("targetItems");
                if (grid) {
                    const card = grid.querySelector(".skin-card.selected");
                    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }

                const realChance = calcChance();
                if (msg) {
                    msg.textContent =
                        "Цель под " +
                        label +
                        ": " +
                        (best.name || "Скин") +
                        " · шанс ~" +
                        realChance.toFixed(1).replace(".", ",") +
                        "%";
                }
            });
        });

        document.getElementById("targetSearch")?.addEventListener("input", (e) => {
            renderCatalog(e.target.value);
        });

        document.getElementById("upgradeBtn")?.addEventListener("click", doUpgrade);

        loadData();
    });
})();
