# Laserfiche Web Access acknowledgement tracking

## The final deployment layout

`ManagerAcknowledgeAction.js` is intentionally the **single functional file**. It
contains both parts that must follow the same history-field contract:

- `window.runManagerAcknowledgeAction()` for the manager's navbar button.
- The automatic recipient watcher that runs whenever `DocView.aspx` opens.

Keeping both parts in one file prevents the manager and recipient rules from
becoming different again. `AutoAcknowledgeInline.js` is only a compatibility
diagnostic and is not required.

Copy `ManagerAcknowledgeAction.js` to:

```text
<web-access-site>/CustomTabs/ManagerAcknowledgeAction.js
```

At the end of `DocView.aspx`, immediately before `</body>`, use exactly:

```html
<script src="/laserfiche/CustomTabs/ManagerAcknowledgeAction.js?v=2"></script>
```

Do **not** comment out that tag. Remove the old duplicate code and the old
`AutoAcknowledgeInline.js` tag. Increment `v=2` whenever the JavaScript changes so
the browser does not reuse an old cached version.

The existing button remains:

```html
<li id="customManagerAckButton" class="cmd-item ocrButtonContainer">
    <a href="#" role="menuitem"
       onclick="window.runManagerAcknowledgeAction(); return false;">
        <span>Tracking</span>
    </a>
</li>
```

## Tracking contract

1. An authorized manager selects one document and presses **Tracking**.
2. The script appends `Manager_Test ==> Acknowledge - <timestamp>` to `حاله الملف`.
   This line starts a new tracking round.
3. The workflow distributes the same repository document/entry. It must not create
   a copy with a different entry ID and must preserve template `Test_acknowledge`.
4. When a non-exempt recipient opens that document in `DocView.aspx`, the watcher
   reads the field and blocks the viewer until the recipient chooses a response.
5. Recipient `Acknowledge` completes that round for that recipient. Recipient
   `Unacknowledge` is saved and the viewer navigates back; the prompt returns next
   time the document is opened.

Configured exempt accounts (`ADMIN` and `Manager_Test`) do not receive the
recipient popup. Username comparisons ignore capitalization and surrounding spaces.

## Laserfiche test procedure

### 1. Confirm the JavaScript is really loaded

1. Restart/recycle the Web Access application pool after changing deployed files.
2. Open DevTools (`F12`), select **Network**, enable **Disable cache**, and reload
   `DocView.aspx` with `Ctrl+F5`.
3. Filter Network by `ManagerAcknowledgeAction.js`. It must return HTTP `200`, and
   its Response must contain `tracking loaded (v2)`.
4. In Console, verify the message:

   ```text
   [AutoAck] Manager and recipient tracking loaded (v2).
   ```

5. Run:

   ```javascript
   typeof window.runManagerAcknowledgeAction
   ```

   The result must be `"function"`. `undefined` means the URL/tag/cache is wrong.

### 2. Test the manager path

1. Sign in as `Manager_Test` or `ADMIN`.
2. Select exactly one document whose template is `Test_acknowledge`.
3. Press **Tracking**, confirm the dialog, and wait for the success dialog.
4. Refresh Fields and confirm that `حاله الملف` ends with a manager line containing
   `==> Acknowledge -`.
5. In Network, confirm successful calls to `GetMetadata`, `LockDocument`,
   `SaveEntry`, and `UnlockDocument`.

### 3. Test the recipient path

1. Use a separate private/incognito browser session and sign in as a recipient who
   is not in `exemptUsers`.
2. Open the **same entry ID** distributed by the workflow.
3. The blocking dialog must appear automatically; no Tracking-button click is
   needed for a recipient.
4. Choose **Acknowledge**, then verify a new recipient line in `حاله الملف`.
5. Reload the same entry: that recipient should no longer be prompted for the same
   round.
6. Start a new round as the manager and reopen it as the recipient: the prompt must
   appear again.
7. Repeat using **Unacknowledge**: the choice should be saved, the viewer should go
   back, and reopening should show the prompt again.

### 4. If the popup still does not appear

In the recipient Console check:

```javascript
typeof window.runManagerAcknowledgeAction
document.querySelector('[lf-bind-once="loginInfo.DisplayUser"]')?.textContent
webAccessApi.getFocusedEntries()
```

Then verify all of the following: the script request is HTTP `200`; there are no
red Console errors; the entry has template `Test_acknowledge`; the opened entry ID
is the same one armed by the manager; and `حاله الملف` contains the manager
`Acknowledge` line. The screenshot in the original setup showed the
`AutoAcknowledgeInline.js` script tag commented out; commented scripts never run.
