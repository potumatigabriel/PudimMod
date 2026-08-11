/**
 * PudimMod - pudim_ally_bar.js
 */

var g_PudimAllyBarLastUpdate = 0;
// Flash state keyed by player ID (not row index) — order can change between frames
var g_PudimAllyLastPhase = {};
var g_PudimAllyFlashEndTime = {};
var g_PudimAllyFlashType = {};

const PUDIM_PHASE_LABELS = { 1: "I", 2: "II", 3: "III", 4: "IV" };
const PUDIM_PHASE_COLORS = { 1: "200 200 100", 2: "100 200 140", 3: "80 150 240", 4: "200 100 240" };
const PUDIM_MAX_ROWS = 9;

function pudim_UpdateAllyBar() {
    const now = Date.now();
    if (now - g_PudimAllyBarLastUpdate < 1000) return;
    g_PudimAllyBarLastUpdate = now;

    let allies;
    try { allies = Engine.GuiInterfaceCall("pudim_GetAllyStats"); } catch(e) { return; }
    const container = Engine.TryGetGUIObjectByName("pudimAllyBar");

    if (!allies || allies.length === 0) {
        if (container) container.hidden = true;
        return;
    }

    if (container) container.hidden = false;

    for (let i = 0; i < PUDIM_MAX_ROWS; ++i) {
        const row = Engine.TryGetGUIObjectByName("pudimAllyRow[" + i + "]");
        if (!row) continue;

        if (i >= allies.length) {
            row.hidden = true;
            continue;
        }

        row.hidden = false;
        const d = allies[i];
        const pid = d.id;

        const sz = row.size;
        sz.top = i * 26;
        sz.bottom = (i + 1) * 26;
        row.size = sz;

        // Flash state keyed by player ID
        const prevPhase = g_PudimAllyLastPhase[pid];
        if (prevPhase !== undefined && d.phase > prevPhase) {
            g_PudimAllyFlashEndTime[pid] = now + 4000;
            g_PudimAllyFlashType[pid] = "phase_done";
        } else if (d.isResearchingPhase && g_PudimAllyFlashType[pid] !== "phase_done") {
            if (g_PudimAllyFlashType[pid] !== "phase_upgrade") {
                g_PudimAllyFlashEndTime[pid] = now + 999999;
                g_PudimAllyFlashType[pid] = "phase_upgrade";
            }
        } else if (d.gatherers && d.gatherers.isUnderAttack && !d.isSelf &&
                   g_PudimAllyFlashType[pid] !== "phase_done" && g_PudimAllyFlashType[pid] !== "phase_upgrade") {
            g_PudimAllyFlashEndTime[pid] = now + 2000;
            g_PudimAllyFlashType[pid] = "under_attack";
        } else if (!d.isResearchingPhase && g_PudimAllyFlashType[pid] === "phase_upgrade") {
            g_PudimAllyFlashEndTime[pid] = 0;
            g_PudimAllyFlashType[pid] = null;
        } else if (!(d.gatherers && d.gatherers.isUnderAttack) && g_PudimAllyFlashType[pid] === "under_attack") {
            g_PudimAllyFlashEndTime[pid] = 0;
            g_PudimAllyFlashType[pid] = null;
        }
        g_PudimAllyLastPhase[pid] = d.phase;

        let nameObj  = Engine.TryGetGUIObjectByName("pudimAllyName[" + i + "]");
        let popObj   = Engine.TryGetGUIObjectByName("pudimAllyPop[" + i + "]");
        let foodObj  = Engine.TryGetGUIObjectByName("pudimAllyFood[" + i + "]");
        let woodObj  = Engine.TryGetGUIObjectByName("pudimAllyWood[" + i + "]");
        let stoneObj = Engine.TryGetGUIObjectByName("pudimAllyStone[" + i + "]");
        let metalObj = Engine.TryGetGUIObjectByName("pudimAllyMetal[" + i + "]");
        let kdObj    = Engine.TryGetGUIObjectByName("pudimAllyKD[" + i + "]");
        let armyObj  = Engine.TryGetGUIObjectByName("pudimAllyArmy[" + i + "]");

        let cColor = d.color || {r: 1, g: 1, b: 1};
        let colorStr = Math.round(cColor.r * 255) + " " + Math.round(cColor.g * 255) + " " + Math.round(cColor.b * 255) + " 255";

        const prefix = d.isSelf ? "★" : " ";
        let nick = (g_Players && g_Players[pid] && g_Players[pid].name) ? g_Players[pid].name : ("P" + pid);
        nick = nick.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (nick.length > 16) nick = nick.slice(0, 15) + "~";
        const phaseLabel = PUDIM_PHASE_LABELS[d.phase] || "";
        const phaseColor = PUDIM_PHASE_COLORS[d.phase] || "160 160 160";

        if (nameObj) {
            nameObj.caption = prefix + nick + "  [color=\"" + phaseColor + "\"]" + phaseLabel + "[/color]";
            nameObj.textcolor = colorStr;
        }
        if (popObj) popObj.caption = d.popCount + "/" + d.popLimit;

        const g = d.gatherers || {};
        const rf = Math.floor((d.res || {}).food || 0);
        const rw = Math.floor((d.res || {}).wood || 0);
        const rs = Math.floor((d.res || {}).stone || 0);
        const rm = Math.floor((d.res || {}).metal || 0);

        if (foodObj)  foodObj.caption  = rf + " [color=\"255 240 150 200\"](" + (g.food||0) + ")[/color]";
        if (woodObj)  woodObj.caption  = rw + " [color=\"200 255 150 200\"](" + (g.wood||0) + ")[/color]";
        if (stoneObj) stoneObj.caption = rs + " [color=\"220 220 220 200\"](" + (g.stone||0) + ")[/color]";
        if (metalObj) metalObj.caption = rm + " [color=\"180 230 255 200\"](" + (g.metal||0) + ")[/color]";

        let kills  = d.kills  || 0;
        let deaths = d.deaths || 0;
        let ratio  = deaths === 0 ? kills : (kills / deaths).toFixed(1);
        if (kdObj) kdObj.caption = "[color=\"80 210 80\"]" + kills + "k[/color]/[color=\"210 80 80\"]" + deaths + "d[/color] [color=\"220 220 220\"]" + ratio + "[/color]";

        if (armyObj) {
            let s = d.support || 0; let inf = d.infantry || 0; let cav = d.cavalry || 0;
            let arq = d.ranged || 0; let sie = d.siege || 0;
            armyObj.caption = "[color=\"220 220 220\"]Al:" + s + "[/color] " +
                              "[color=\"180 200 255\"]In:" + inf + "[/color] " +
                              "[color=\"255 190 140\"]Ca:" + cav + "[/color] " +
                              "[color=\"180 240 180\"]Ar:" + arq + "[/color]" +
                              (sie > 0 ? " [color=\"220 180 220\"]Si:" + sie + "[/color]" : "");
        }
    }

    pudim_UpdateAllyFlash(now, allies);
}

function pudim_UpdateAllyFlash(now, allies) {
    for (let i = 0; i < PUDIM_MAX_ROWS; ++i) {
        const row = Engine.TryGetGUIObjectByName("pudimAllyRow[" + i + "]");
        if (!row || row.hidden) continue;

        const d = allies && allies[i];
        const pid = d ? d.id : null;
        const flashEnd  = pid !== null ? (g_PudimAllyFlashEndTime[pid] || 0) : 0;
        const flashType = pid !== null ? g_PudimAllyFlashType[pid] : null;

        const bgOverlay = Engine.TryGetGUIObjectByName("pudimAllyBgOverlay[" + i + "]");

        if (d && d.isSelf) {
            // Próprio jogador: fundo azul escuro semi-transparente no row, overlay transparente
            row.sprite = "color: 10 30 100 180";
            if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
        } else if (flashEnd > now) {
            if (flashType === "phase_upgrade") {
                row.sprite = "color: 20 140 50 150";
                if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            } else if (flashType === "phase_done") {
                const blink = (Math.floor(now / 300) % 2 === 0);
                row.sprite = blink ? "color: 20 60 200 210" : "color: 0 0 0 190";
                if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            } else if (flashType === "under_attack") {
                row.sprite = "color: 160 10 10 150";
                if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            }
        } else {
            if (pid !== null && flashType) {
                g_PudimAllyFlashType[pid] = null;
                g_PudimAllyFlashEndTime[pid] = 0;
            }
            row.sprite = "color: 0 0 0 190";
            if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
        }
    }
}
