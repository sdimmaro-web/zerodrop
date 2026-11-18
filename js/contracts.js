(() => {
    const MAX_SLOTS = 10;
    const MIN_ITEMS = 3;

    let inventory = [];
    let selected = []; // array of inventory item ids in contract order
    let busy = false;
    let userBalance = 0;

    const money = (n) => Number(n || 0).toLocaleString("ru-RU") + " ₽";

    function calcSum() {
        let s = 0;
        for (const id of selected) {
            const it = inventory.find((x) => String(x.id) === String(id));
            if (it) s += Number(it.price) || 0;
        }
        return Math.round(s * 100) / 100;
    }

    function rangeFromSum(sum) {
        // как на Case Battle: ~0.33x … ~4.5x от суммы
        const min = Math.max(1, Math.round(sum * 0.33 * 100) / 100);
        const max = Math.max(min + 1, Math.round(sum * 4.5 * 100) / 100);
        return { min, max };
    }

    function renderSlots() {
        const box = document.getElementById("contractSlots");
        if (!box) return;
        box.innerHTML = "";
        for (let i = 0; i < MAX_SLOTS; i++) {
            const slot = document.createElement("div");
            slot.className = "contract-slot";
            const id = selected[i];
            if (id) {
                const it = inventory.find((x) => String(x.id) === String(id));
                if (it) {
                    slot.classList.add("filled");
                    slot.innerHTML =
                        `<button type="button" class="slot-x" data-id="${it.id}" title="Убрать">×</button>` +
                        `<img src="${it.image || ""}" alt="">` +
                        `<div class="slot-price">${money(it.price)}</div>`;
                }
            }
            box.appendChild(slot);
        }
        box.querySelectorAll(".slot-x").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = btn.getAttribute("data-id");
                selected = selected.filter((x) => String(x) !== String(id));
                hideResult();
                renderAll();
            });
        });
    }

    function renderInventory() {
        const box = document.getElementById("myItems");
        const cnt = document.getElementById("invCount");
        if (cnt) cnt.textContent = inventory.length + " шт.";
        if (!box) return;
        if (!inventory.length) {
            box.innerHTML = '<div class="empty-hint">Инвентарь пуст. Откройте кейсы или сделайте апгрейд.</div>';
            return;
        }
        box.innerHTML = inventory
            .map((it) => {
                const inC = selected.some((id) => String(id) === String(it.id));
                return (
                    `<div class="skin-card${inC ? " in-contract" : ""}" data-id="${it.id}">` +
                    `<img src="${it.image || ""}" alt="">` +
                    `<div class="n">${it.name || "Скин"}</div>` +
                    `<div class="p">${money(it.price)}</div>` +
                    `</div>`
                );
            })
            .join("");
    }

    function updateInfo() {
        const sum = calcSum();
        const n = selected.length;
        const sumEl = document.getElementById("ciSum");
        const hint = document.getElementById("ciHint");
        const btn = document.getElementById("signBtn");
        const balEl = document.getElementById("ciBalance");

        if (sumEl) sumEl.textContent = money(sum);
        if (balEl) balEl.textContent = money(userBalance);

        if (n < MIN_ITEMS) {
            if (hint) hint.textContent = `Положите ещё минимум ${MIN_ITEMS - n} предмет${MIN_ITEMS - n === 1 ? "" : "а"}`;
            if (btn) btn.disabled = true;
        } else {
            const r = rangeFromSum(sum);
            if (hint) {
                hint.innerHTML =
                    `Вы получите предмет<br><b style="color:#ffb400">от ${money(r.min)} до ${money(r.max)}</b>`;
            }
            if (btn) btn.disabled = busy;
        }
    }

    function hideResult() {
        const el = document.getElementById("contractResult");
        if (el) el.classList.remove("show");
    }

    function showResult(item) {
        const el = document.getElementById("contractResult");
        if (!el || !item) return;
        document.getElementById("resultImg").src = item.image || "";
        document.getElementById("resultName").textContent = item.name || "Скин";
        document.getElementById("resultPrice").textContent = money(item.price);
        el.classList.add("show");
    }

    function renderAll() {
        renderSlots();
        renderInventory();
        updateInfo();
    }

    async function loadAccount() {
        try {
            const res = await fetch("/api/account", { credentials: "same-origin", headers: { Accept: "application/json" } });
            const data = await res.json();
            userBalance = Number(data.balance) || 0;
            inventory = Array.isArray(data.inventory) ? data.inventory : [];
            if (window.DoodropBalance) window.DoodropBalance.paint(userBalance);
            // убрать из selected то, чего больше нет
            selected = selected.filter((id) => inventory.some((it) => String(it.id) === String(id)));
            renderAll();
        } catch (e) {
            console.warn(e);
            renderAll();
        }
    }

    async function signContract() {
        if (busy || selected.length < MIN_ITEMS) return;
        busy = true;
        hideResult();
        document.getElementById("contractMsg").textContent = "Подписание контракта...";
        updateInfo();
        try {
            const res = await fetch("/api/account", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    action: "contract",
                    item_ids: selected.slice()
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Ошибка контракта");

            userBalance = data.balance;
            inventory = data.inventory || [];
            if (window.DoodropBalance) window.DoodropBalance.paint(userBalance);
            selected = [];
            document.getElementById("contractMsg").textContent = "Контракт выполнен!";
            if (data.item) showResult(data.item);
            renderAll();
        } catch (err) {
            document.getElementById("contractMsg").textContent = err.message || "Ошибка";
        } finally {
            busy = false;
            updateInfo();
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("myItems")?.addEventListener("click", (e) => {
            const card = e.target.closest(".skin-card");
            if (!card || busy) return;
            const id = card.getAttribute("data-id");
            if (!id) return;
            if (selected.some((x) => String(x) === String(id))) return;
            if (selected.length >= MAX_SLOTS) {
                document.getElementById("contractMsg").textContent = "Максимум " + MAX_SLOTS + " предметов";
                return;
            }
            selected.push(id);
            hideResult();
            document.getElementById("contractMsg").textContent = "";
            renderAll();
        });

        document.getElementById("signBtn")?.addEventListener("click", signContract);

        loadAccount();
        // периодически подтягивать инвентарь если открыли кейс в другой вкладке
        setInterval(loadAccount, 15000);
    });
})();
