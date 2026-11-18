// Профиль DOODROP: Steam-аккаунт, серверный баланс/инвентарь, продажа.
(() => {
    function formatMoney(value) {
        return Number(value || 0).toLocaleString("ru-RU") + " ₽";
    }

    function rarityClass(r) {
        const x = String(r || "").toLowerCase();
        if (x.includes("legend") || x.includes("covert")) return "legendary";
        if (x.includes("epic") || x.includes("class")) return "epic";
        if (x.includes("rare") || x.includes("restrict")) return "rare";
        if (x.includes("uncommon") || x.includes("mil")) return "uncommon";
        return "common";
    }

    function renderBestDrop() {
        const inv = window.DoodropInventory;
        const best = inv ? inv.best() : null;
        const nameEl = document.getElementById("bestDropName");
        const rarityEl = document.getElementById("bestDropRarity");
        const priceEl = document.getElementById("bestDropPrice");
        const imgEl = document.getElementById("bestDropImage");
        if (!nameEl) return;

        if (!best) {
            nameEl.textContent = "Пока нет дропов";
            if (rarityEl) rarityEl.textContent = "Открой кейс, чтобы получить первый скин";
            if (priceEl) priceEl.textContent = "0 ₽";
            if (imgEl) imgEl.src = "images/avatar-placeholder.svg";
            return;
        }

        nameEl.textContent = best.name;
        if (rarityEl) {
            rarityEl.textContent =
                (best.rarity || "Unknown") +
                (best.from_case ? (" · из кейса «" + best.from_case + "»") : "");
        }
        if (priceEl) priceEl.textContent = formatMoney(best.price);
        if (imgEl) imgEl.src = best.image || "images/avatar-placeholder.svg";
    }

    function renderInventory() {
        const grid = document.getElementById("inventoryGrid");
        const countEl = document.getElementById("inventoryCount");
        const valueEl = document.getElementById("inventoryValue");
        const itemsWonEl = document.getElementById("itemsWon");
        const sellAllBtn = document.getElementById("sellAllInvBtn");
        const inv = window.DoodropInventory;
        const items = inv ? inv.list() : [];
        // от дорогих к дешёвым
        const sorted = items.slice().sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
        const totalValue = inv ? inv.value() : 0;

        if (countEl) countEl.textContent = items.length + " предметов";
        if (valueEl) valueEl.textContent = formatMoney(totalValue);
        if (itemsWonEl) itemsWonEl.textContent = String(items.length);

        if (sellAllBtn) {
            if (items.length) {
                sellAllBtn.hidden = false;
                sellAllBtn.disabled = false;
                sellAllBtn.textContent = "Продать всё · " + formatMoney(totalValue);
            } else {
                sellAllBtn.hidden = true;
            }
        }

        if (!grid) return;

        if (!items.length) {
            grid.innerHTML =
                '<p style="color:#8d97ad;grid-column:1/-1">Инвентарь пуст. Открой кейс — выпавший скин появится здесь.</p>';
            return;
        }

        grid.innerHTML = sorted
            .map((it) => {
                const id = String(it.id || "");
                const price = Number(it.price) || 0;
                return `
            <div class="inventory-item ${rarityClass(it.rarity)}" data-id="${id}">
                <img src="${it.image || "images/avatar-placeholder.svg"}" alt="">
                <div class="item-title">${it.name || "Скин"}</div>
                <div class="item-price">${formatMoney(price)}</div>
                <button class="sell-item" type="button" data-id="${id}">
                    Продать · ${formatMoney(price)}
                </button>
            </div>`;
            })
            .join("");
    }

    async function sellAllInventory() {
        const inv = window.DoodropInventory;
        if (!inv) return;
        const items = inv.list();
        if (!items.length) return;

        const total = inv.value();
        if (
            !confirm(
                "Продать все предметы (" + items.length + " шт.) за " + formatMoney(total) + "?"
            )
        ) {
            return;
        }

        const btn = document.getElementById("sellAllInvBtn");
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Продаём...";
        }

        try {
            const ids = items.map((it) => it.id).filter(Boolean);
            if (inv.sellMany) {
                await inv.sellMany(ids);
            } else {
                for (const id of ids) {
                    await inv.sell(id);
                }
            }
            renderInventory();
            renderBestDrop();
        } catch (err) {
            alert(err.message || "Не удалось продать");
            renderInventory();
        }
    }

    async function sellItem(id) {
        const inv = window.DoodropInventory;
        if (!inv) return;

        const item = inv.list().find((x) => String(x.id) === String(id));
        if (!item) {
            alert("Предмет не найден");
            renderInventory();
            return;
        }

        const price = Math.max(0, Math.round(Number(item.price) || 0));
        if (!confirm("Продать «" + (item.name || "скин") + "» за " + formatMoney(price) + "?")) return;

        try {
            await inv.sell(id);
            renderInventory();
            renderBestDrop();
        } catch (err) {
            alert(err.message || "Не удалось продать");
        }
    }

    function renderStats(user) {
        const openedCases = document.getElementById("openedCases");
        const moneySpent = document.getElementById("moneySpent");
        if (openedCases) openedCases.textContent = String(user?.openedCases || 0);
        if (moneySpent) moneySpent.textContent = formatMoney(user?.moneySpent || 0);
    }

    document.addEventListener("DOMContentLoaded", async () => {
        const auth = window.DoodropAuth;
        const user = auth ? await auth.loadUser(true) : null;

        if (!user) {
            const grid = document.getElementById("inventoryGrid");
            if (grid) {
                grid.innerHTML =
                    '<p style="color:#8d97ad;grid-column:1/-1">Войдите через Steam, чтобы видеть баланс и инвентарь.</p>';
            }
            renderBestDrop();
            return;
        }

        if (window.DoodropBalance) window.DoodropBalance.paint(user.balance);

        const tradeUrl = document.getElementById("tradeUrl");
        const email = document.getElementById("email");
        const promoCode = document.getElementById("promoCode");
        const activatePromo = document.getElementById("activatePromo");

        if (tradeUrl) {
            tradeUrl.value = localStorage.getItem("tradeurl_" + user.steamId) || "";
            tradeUrl.addEventListener("input", () => {
                localStorage.setItem("tradeurl_" + user.steamId, tradeUrl.value.trim());
            });
        }

        if (email) {
            email.value = localStorage.getItem("email_" + user.steamId) || "";
            email.addEventListener("input", () => {
                localStorage.setItem("email_" + user.steamId, email.value.trim());
            });
        }

        if (activatePromo && promoCode) {
            activatePromo.addEventListener("click", async () => {
                const code = promoCode.value.trim().toUpperCase();
                if (code !== "DOODROP") {
                    alert("Промокод неверный");
                    return;
                }
                const key = "promo_DOODROP_" + user.steamId;
                if (localStorage.getItem(key) === "1") {
                    alert("Этот промокод уже был активирован");
                    return;
                }
                if (window.DoodropBalance) await window.DoodropBalance.add(500);
                localStorage.setItem(key, "1");
                promoCode.value = "";
                alert("Промокод активирован! +500 ₽");
            });
        }

        document.querySelectorAll(".deposit, .deposit-btn").forEach((button) => {
            button.addEventListener("click", async () => {
                const amount = Number(prompt("Сколько пополнить?"));
                if (!Number.isFinite(amount) || amount <= 0) return;
                if (window.DoodropBalance) await window.DoodropBalance.add(amount);
            });
        });

        const historyButton = document.querySelector(".history-btn");
        if (historyButton) {
            historyButton.addEventListener("click", () => {
                alert("История операций будет подключена позже.");
            });
        }

        const grid = document.getElementById("inventoryGrid");
        if (grid) {
            grid.addEventListener("click", (e) => {
                const btn = e.target.closest(".sell-item");
                if (!btn) return;
                e.preventDefault();
                sellItem(btn.getAttribute("data-id"));
            });
        }

        document.getElementById("sellAllInvBtn")?.addEventListener("click", sellAllInventory);

        renderStats(user);
        renderInventory();
        renderBestDrop();
    });
})();
