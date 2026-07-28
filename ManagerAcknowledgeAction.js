(function () {
    "use strict";

    var config = {
        targetTemplate: "Test_acknowledge",
        statusField: "حاله الملف",
        repoName: "Demo",
        exemptUsers: ["ADMIN", "Manager_Test"],
        managerUsers: ["Manager_Test"],
        overlayId: "parentBlockOverlay",
        managerOverlayId: "managerAckOverlay",
        styleId: "parentBlockOverlayStyles",
        ownerKey: "__ackActiveInstance",
        checkIntervalMs: 400,
        throttleMs: 800
    };
    var action = { acknowledge: "Acknowledge", unacknowledge: "Unacknowledge" };
    var urls = {
        metadata: "/laserfiche/MetadataService.ashx/GetMetadata",
        lock: "/laserfiche/DocumentService.ashx/LockDocument",
        unlock: "/laserfiche/DocumentService.ashx/UnlockDocument",
        save: "/laserfiche/DocumentService.ashx/SaveEntry"
    };
    var parentWindow = window.parent || window;
    var instanceId = Date.now() + "_" + Math.random().toString(36).slice(2);
    var states = {};
    var intervalId = null;
    var saving = false;
    /* Prevent the recipient poller from deleting the manager's overlay. */
    var managerUiActive = false;

    function normalize(value) {
        return String(value || "").trim();
    }

    function sameUser(left, right) {
        return normalize(left).toLowerCase() === normalize(right).toLowerCase();
    }

    function containsUser(users, userName) {
        return users.some(function (item) { return sameUser(item, userName); });
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>'"]/g, function (character) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character];
        });
    }

    function getCurrentUserName() {
        var selector = '[lf-bind-once="loginInfo.DisplayUser"]';
        try {
            var boundElement = parentWindow.document.querySelector(selector);
            if (boundElement && parentWindow.angular) {
                var scope = parentWindow.angular.element(boundElement).scope();
                for (var depth = 0; scope && depth < 8; depth++, scope = scope.$parent) {
                    if (scope.loginInfo && scope.loginInfo.DisplayUser) {
                        return normalize(scope.loginInfo.DisplayUser);
                    }
                }
            }
            return normalize(boundElement && (boundElement.textContent || boundElement.innerText)) || "Unknown";
        } catch (ignore) {
            return "Unknown";
        }
    }

    function getXsrfToken() {
        var match = String(parentWindow.document.cookie || "").match(/(?:^|;\s*)XSRF-TOKEN-HTTP=([^;]*)/);
        return match ? decodeURIComponent(match[1]) : "";
    }

    function postJson(url, body) {
        return parentWindow.fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                "Lf-Repository": config.repoName,
                "X-Lf-Repo-ID": config.repoName,
                "X-XSRF-TOKEN": getXsrfToken()
            },
            body: JSON.stringify(body)
        }).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status + " calling " + url);
            return response.json();
        });
    }

    function getFocusedEntry() {
        try {
            var api = parentWindow.webAccessApi || (typeof webAccessApi !== "undefined" && webAccessApi);
            var entries = api && api.getFocusedEntries && api.getFocusedEntries();
            return entries && entries.length === 1 ? entries[0] : null;
        } catch (ignore) {
            return null;
        }
    }

    function getViewerEntryId() {
        try {
            var location = parentWindow.location;
            var source = String(location.hash || "") + "&" + String(location.search || "") + "&" + String(location.href || "");
            var match = source.match(/[?#&](?:id|entryId|docId|documentId)=(\d+)/i);
            return match ? match[1] : null;
        } catch (ignore) {
            return null;
        }
    }

    function getStatusField(entryId) {
        return postJson(urls.metadata, {
            repoName: config.repoName,
            entryIds: [String(entryId)],
            metadataFlags: 1
        }).then(function (result) {
            var fields = result && result.d && result.d.Fields && result.d.Fields.templateFields;
            if (!fields) throw new Error("Laserfiche did not return templateFields.");
            for (var index = 0; index < fields.length; index++) {
                if (fields[index].name === config.statusField) return fields[index];
            }
            return null;
        });
    }

    function parseLine(line) {
        var match = String(line || "").match(/^(.+?)\s+==>\s+(Unacknowledge|Acknowledge)\s+-\s+(.+)$/i);
        return match ? { userName: normalize(match[1]), action: match[2].toLowerCase(), line: line } : null;
    }

    function getLines(value) {
        var normalized = normalize(value);
        return normalized ? normalized.split(/\r?\n/) : [];
    }

    /* A manager Acknowledge starts (arms) a tracking round. */
    function latestManagerArm(value) {
        var lines = getLines(value);
        for (var index = lines.length - 1; index >= 0; index--) {
            var parsed = parseLine(lines[index]);
            if (parsed && parsed.action === action.acknowledge.toLowerCase() && containsUser(config.managerUsers, parsed.userName)) {
                return { index: index, line: lines[index] };
            }
        }
        return null;
    }

    function needsAcknowledgement(value, userName) {
        var lines = getLines(value);
        var arm = latestManagerArm(value);
        if (!arm) return false;
        for (var index = lines.length - 1; index > arm.index; index--) {
            var parsed = parseLine(lines[index]);
            if (parsed && sameUser(parsed.userName, userName)) {
                return parsed.action !== action.acknowledge.toLowerCase();
            }
        }
        return true;
    }

    function ensureStyles() {
        var document = parentWindow.document;
        if (document.getElementById(config.styleId)) return;
        var style = document.createElement("style");
        style.id = config.styleId;
        var overlaySelector = ".ackTrackingOverlay";
        style.textContent =
            "@keyframes ackSpin{to{transform:rotate(360deg)}}" +
            overlaySelector + "{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.9);backdrop-filter:blur(6px);font-family:'Segoe UI',Tahoma,Arial,sans-serif}" +
            overlaySelector + " .box{direction:rtl;width:min(380px,calc(100vw - 48px));padding:34px;background:#fff;border-radius:16px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}" +
            overlaySelector + " .badge{display:flex;align-items:center;justify-content:center;width:52px;height:52px;margin:0 auto 16px;border-radius:50%;color:#fff;background:#2563eb;font-size:24px}" +
            overlaySelector + " .spinner{width:22px;height:22px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:ackSpin .8s linear infinite}" +
            overlaySelector + " .title{font-size:18px;font-weight:700;color:#0f172a}" +
            overlaySelector + " .msg{margin:8px 0 24px;white-space:pre-line;line-height:1.7;color:#475569}" +
            overlaySelector + " .doc{display:block;color:#1e40af;font-weight:700}" +
            overlaySelector + " .buttons{display:flex;gap:10px}" +
            overlaySelector + " button{flex:1;padding:12px;border:0;border-radius:10px;color:#fff;font-weight:700;cursor:pointer}" +
            overlaySelector + " .ack{background:#15803d}" + overlaySelector + " .unack{background:#b91c1c}" +
            overlaySelector + " .close{display:block;width:100%;margin-top:12px;background:#475569}";
        document.head.appendChild(style);
    }

    function render(html, overlayId) {
        var document = parentWindow.document;
        overlayId = overlayId || config.overlayId;
        ensureStyles();
        var overlay = document.getElementById(overlayId) || document.createElement("div");
        overlay.id = overlayId;
        overlay.className = "ackTrackingOverlay";
        overlay.innerHTML = html;
        if (!overlay.parentNode) document.body.appendChild(overlay);
        return overlay;
    }

    function removeOverlay(overlayId) {
        var overlay = parentWindow.document.getElementById(overlayId || config.overlayId);
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function lock(entryId) {
        return postJson(urls.lock, { repoName: config.repoName, documentId: entryId, lockEfile: false, autoCheckout: false });
    }

    function unlock(entryId) {
        return postJson(urls.unlock, { repoName: config.repoName, documentId: entryId }).catch(function (error) {
            if (parentWindow.console) parentWindow.console.warn("[AutoAck] Unlock failed.", error);
        });
    }

    function save(entryId, fieldId, value) {
        return postJson(urls.save, {
            repoName: config.repoName,
            documentId: entryId,
            curPageNum: 0,
            strCurPageId: 0,
            changes: { dirty: true, newTemplateId: 0, removeTemplate: false, fieldChanges: [{ fieldId: fieldId, value: value, remove: false, fieldIndex: 0 }], tagChanges: [], linkChanges: [] },
            generalchanges: [],
            annchanges: []
        });
    }

    function recordDecision(context, selectedAction) {
        if (saving) return;
        saving = true;
        render('<div class="box"><div class="badge"><div class="spinner"></div></div><div class="title">جاري التسجيل</div><div class="msg">من فضلك انتظر لحظة...</div></div>');
        lock(context.entryId).then(function () {
            return getStatusField(context.entryId);
        }).then(function (freshField) {
            if (!freshField) throw new Error("Status field is missing: " + config.statusField);
            var value = freshField.value || freshField.Value || "";
            var line = context.userName + " ==> " + selectedAction + " - " + new Date().toLocaleString("en-US");
            return save(context.entryId, freshField.id, value ? value + "\n" + line : line);
        }).then(function () {
            return unlock(context.entryId);
        }).then(function () {
            saving = false;
            delete states[context.scopeKey];
            removeOverlay();
            if (selectedAction === action.unacknowledge) parentWindow.history.back();
        }).catch(function (error) {
            saving = false;
            unlock(context.entryId);
            if (parentWindow.console) parentWindow.console.error("[AutoAck] Save failed.", error);
            showChoice(context, "حصل خطأ أثناء التسجيل، حاول مرة أخرى.");
        });
    }

    function showChoice(context, message) {
        var overlay = render(
            '<div class="box"><div class="badge">🔒</div><div class="title">تأكيد فتح الوثيقة</div>' +
            '<div class="msg">' + escapeHtml(message || "يجب تأكيد فتح هذه الوثيقة قبل المتابعة") +
            (context.docName ? '<span class="doc">&quot;' + escapeHtml(context.docName) + '&quot;</span>' : "") + '</div>' +
            '<div class="buttons"><button class="ack" data-action="ack">✓ Acknowledge</button><button class="unack" data-action="unack">✕ Unacknowledge</button></div></div>'
        );
        overlay.querySelector('[data-action="ack"]').onclick = function () { recordDecision(context, action.acknowledge); };
        overlay.querySelector('[data-action="unack"]').onclick = function () { recordDecision(context, action.unacknowledge); };
    }

    function managerButton() {
        return parentWindow.document.getElementById("customManagerAckButton");
    }

    function releaseManagerButton() {
        parentWindow.__managerAckRunningEntryId = null;
        var button = managerButton();
        if (button) button.classList.remove("ocr-running");
    }

    function showManagerResult(message, isError) {
        var overlay = render(
            '<div class="box"><div class="badge" style="background:' + (isError ? "#b91c1c" : "#15803d") + '">' + (isError ? "!" : "✓") + '</div>' +
            '<div class="title">' + (isError ? "حدث خطأ" : "تم بنجاح") + '</div>' +
            '<div class="msg">' + escapeHtml(message) + '</div><button class="close" data-action="close">إغلاق</button></div>',
            config.managerOverlayId
        );
        overlay.querySelector('[data-action="close"]').onclick = function () {
            managerUiActive = false;
            removeOverlay(config.managerOverlayId);
        };
    }

    function armTracking(context) {
        if (saving) return;
        saving = true;
        render('<div class="box"><div class="badge"><div class="spinner"></div></div><div class="title">جاري تفعيل التتبع</div><div class="msg">من فضلك انتظر لحظة...</div></div>', config.managerOverlayId);
        lock(context.entryId).then(function () {
            return getStatusField(context.entryId);
        }).then(function (field) {
            if (!field) throw new Error("Status field is missing: " + config.statusField);
            var value = field.value || field.Value || "";
            var line = context.userName + " ==> " + action.acknowledge + " - " + new Date().toLocaleString("en-US");
            return save(context.entryId, field.id, value ? value + "\n" + line : line);
        }).then(function () {
            return unlock(context.entryId);
        }).then(function () {
            saving = false;
            releaseManagerButton();
            states = {};
            showManagerResult("تم تفعيل التتبع على المستند بنجاح.", false);
        }).catch(function (error) {
            saving = false;
            unlock(context.entryId);
            releaseManagerButton();
            if (parentWindow.console) parentWindow.console.error("[ManagerAck] Tracking failed.", error);
            showManagerResult("تعذر تفعيل التتبع.\n" + (error && error.message ? error.message : "خطأ غير متوقع"), true);
        });
    }

    /* Called by onclick="window.runManagerAcknowledgeAction();" in the navbar button. */
    parentWindow.runManagerAcknowledgeAction = function () {
        var entry = getFocusedEntry();
        var userName = getCurrentUserName();
        if (!entry) {
            parentWindow.alert("رجاء اختيار مستند واحد فقط");
            return;
        }
        if (!containsUser(config.exemptUsers, userName)) {
            parentWindow.alert("هذه الميزة متاحة للمدير أو الأدمن فقط");
            return;
        }
        if (entry.templateName && entry.templateName !== config.targetTemplate) {
            parentWindow.alert("هذا الزر متاح فقط على مستندات من نوع: " + config.targetTemplate);
            return;
        }
        if (parentWindow.__managerAckRunningEntryId === entry.id || saving) return;
        parentWindow.__managerAckRunningEntryId = entry.id;
        managerUiActive = true;
        var button = managerButton();
        if (button) button.classList.add("ocr-running");

        var context = { entryId: entry.id, userName: userName, docName: entry.name || "" };
        var overlay = render(
            '<div class="box"><div class="badge">✓</div><div class="title">تفعيل متابعة المستند</div>' +
            '<div class="msg">هل تريد بدء جولة متابعة جديدة؟' +
            (context.docName ? '<span class="doc">&quot;' + escapeHtml(context.docName) + '&quot;</span>' : "") + '</div>' +
            '<div class="buttons"><button class="ack" data-action="start">تفعيل Tracking</button><button class="unack" data-action="cancel">إلغاء</button></div></div>',
            config.managerOverlayId
        );
        overlay.querySelector('[data-action="start"]').onclick = function () { armTracking(context); };
        overlay.querySelector('[data-action="cancel"]').onclick = function () {
            managerUiActive = false;
            releaseManagerButton();
            removeOverlay(config.managerOverlayId);
        };
    };

    function currentContext() {
        var entry = getFocusedEntry();
        var viewerId = getViewerEntryId();
        var entryId = viewerId || (entry && entry.id);
        var userName = getCurrentUserName();
        if (!entryId || userName === "Unknown" || containsUser(config.exemptUsers, userName)) return null;
        if (entry && viewerId && String(entry.id) !== String(viewerId)) return null;
        if (entry && entry.templateName && entry.templateName !== config.targetTemplate) return null;
        return { entryId: entryId, userName: userName, docName: entry && entry.name || "", scopeKey: String(entryId) + "_" + userName.toLowerCase() };
    }

    function check() {
        if (parentWindow[config.ownerKey] !== instanceId) {
            if (intervalId) parentWindow.clearInterval(intervalId);
            return;
        }
        /* The manager is exempt from recipient prompts. Without this guard the
           400ms recipient poll removed the manager dialog immediately. */
        if (managerUiActive) return;
        var context = currentContext();
        if (!context) { removeOverlay(); return; }
        var state = states[context.scopeKey] || (states[context.scopeKey] = { checkedAt: 0, reading: false, resolved: false, showing: false });
        if (state.reading || state.resolved || state.showing || Date.now() - state.checkedAt < config.throttleMs) return;
        state.checkedAt = Date.now();
        state.reading = true;
        getStatusField(context.entryId).then(function (field) {
            state.reading = false;
            var latest = currentContext();
            if (!latest || latest.scopeKey !== context.scopeKey) return;
            var value = field && (field.value || field.Value || "");
            if (field && needsAcknowledgement(value, context.userName)) {
                state.showing = true;
                showChoice(context);
            } else {
                state.resolved = true;
                removeOverlay();
            }
        }).catch(function (error) {
            state.reading = false;
            if (parentWindow.console) parentWindow.console.warn("[AutoAck] Metadata read failed.", error);
        });
    }

    parentWindow[config.ownerKey] = instanceId;
    if (parentWindow.console) parentWindow.console.info("[AutoAck] Manager and recipient tracking loaded (v12).");
    check();
    intervalId = parentWindow.setInterval(check, config.checkIntervalMs);
    window.addEventListener("unload", function () {
        if (intervalId) parentWindow.clearInterval(intervalId);
        if (parentWindow[config.ownerKey] === instanceId) parentWindow[config.ownerKey] = null;
    });
}());
