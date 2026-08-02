// How-To view: the in-app user guide. This page is intentionally static
// (no API calls) so it always renders, even before any data exists.
//
// MAINTENANCE: keep this in sync with the app. Whenever a page, control,
// field, or behavior changes, update the matching section below AND bump the
// "Guide revised" date in the intro. Treat it like docs that ship with code.

const main = document.getElementById("main");

const GUIDE_REVISED = "July 2026 (rev 9)";

export async function viewHowto() {
  main.innerHTML = `
    <h1>How-To Guide</h1>
    <p class="sub">A complete walkthrough of PFi — what every page does, how each
      control works, and how the pieces fit together. Guide revised ${GUIDE_REVISED}.</p>

    <div class="grid2 howto-wrap">
      <nav class="panel howto-toc" id="htToc">
        <h2>Contents</h2>
        <ol>
          <li><a data-to="ht-what">What PFi is</a></li>
          <li><a data-to="ht-concepts">Core concepts</a></li>
          <li><a data-to="ht-connect">How it connects</a></li>
          <li><a data-to="ht-topbar">The top bar</a></li>
          <li><a data-to="ht-dashboard">Dashboard</a></li>
          <li><a data-to="ht-trends">Trends</a></li>
          <li><a data-to="ht-monthly">Monthly Entry</a></li>
          <li><a data-to="ht-accounts">Accounts</a></li>
          <li><a data-to="ht-ledgers">Ledgers</a></li>
          <li><a data-to="ht-workflows">Common workflows</a></li>
          <li><a data-to="ht-tips">Tips &amp; gotchas</a></li>
        </ol>
      </nav>

      <div class="howto-body">

        <section class="panel" id="ht-what">
          <h2>What PFi is</h2>
          <p>PFi is a private, local-only portfolio tracker. It replaces the
            MoniesV2 Numbers workbook with a database-backed app you run on your
            own machine. You record your account balances once a month; PFi turns
            that history into net-worth trends, allocation views, and per-account
            charts.</p>
          <p>Everything lives in a local SQLite database. There is no cloud, no
            account, and no telemetry. By default the server only listens on your
            own computer (<code>127.0.0.1</code>); it is exposed on your LAN only
            when you explicitly start it that way (with a login and HTTPS).</p>
          <p><b>Where your data lives.</b> Your database, logs, and TLS certs are
            kept in <code>~/Library/Application&nbsp;Support/PFi/</code> —
            separate from the app itself. The <b>PFi</b> app you launch carries
            only code, no data, so you can move it anywhere or hand a copy to
            someone else without ever sharing your balances. To <b>back up</b>,
            copy <code>~/Library/Application&nbsp;Support/PFi/pfi.db</code>
            somewhere safe. To <b>share the app</b>, run
            <code>~/PFi/build-app.sh --share</code>, which writes a code-only
            <code>PFi-vX.Y.Z.app.zip</code> to your Desktop (the recipient gets a
            fresh, empty database on first launch).</p>
        </section>

        <section class="panel" id="ht-concepts">
          <h2>Core concepts</h2>
          <p>Five ideas underpin everything else:</p>

          <h3>Accounts</h3>
          <p>An <b>account</b> is anything with a balance you want to track — a
            checking account, a brokerage, a house, a credit card, a loan. Every
            account belongs to one <b>group</b> and one <b>asset class</b>.</p>

          <h3>Groups (Kind)</h3>
          <p>Each account sits in exactly one of three groups, which is what
            net worth is built from:</p>
          <ul>
            <li><b>Liquid Assets</b> — cash and things you can sell quickly
              (checking, savings, brokerage).</li>
            <li><b>Non-Liquid Assets</b> — slower-to-sell holdings (real estate,
              retirement accounts, collectibles).</li>
            <li><b>Debts</b> — what you owe (mortgages, cards, loans). Stored as
              positive numbers and <i>subtracted</i> from net worth.</li>
          </ul>

          <h3>Asset classes</h3>
          <p>A finer label used for color-coding and allocation: Cash,
            Stocks / Bonds, Real Estate, Equity / Retirement, Crypto,
            Owed to me, Inventory, and Debt. Each class has a fixed color used
            consistently across the donut and Trends charts. The class is also
            what the allocation views slice by.</p>

          <h3>Monthly snapshots</h3>
          <p>A <b>snapshot</b> is one month's set of balances — the value of
            every active account on (typically) the 1st of the month. Snapshots
            are the spine of the app: every chart and KPI is derived from the
            series of monthly snapshots. You create and edit them on the
            <b>Monthly Entry</b> page.</p>

          <h3>Components &amp; ownership share</h3>
          <p>An account can be split into <b>components</b> (subaccounts) — for
            example a cash line made of several cards, or a brokerage made of
            sleeves. Components store the <b>full</b> dollar value. If you only
            own part of an account (a joint account), set an <b>ownership
            share</b> (e.g. 50%); the value that counts toward net worth is
            <code>sum of components × your share</code>.</p>

          <h3>Linked mortgage (net equity)</h3>
          <p>A real-estate account can be linked to a debt account (its
            mortgage). This lets the Trends view show <b>net real-estate
            equity</b> — the property value minus the linked loan.</p>
        </section>

        <section class="panel" id="ht-connect">
          <h2>How it all connects</h2>
          <p>The data flows in one direction, from accounts up to the charts:</p>
          <ol>
            <li>You define <b>accounts</b> (and optionally their components) on the
              <b>Accounts</b> page.</li>
            <li>Each month you enter balances on <b>Monthly Entry</b>, creating a
              <b>snapshot</b>.</li>
            <li>For every snapshot, PFi computes
              <b>Net Worth = Liquid + Non-Liquid − Debt</b>, where each account's
              contribution is its entered value (or, for component accounts,
              <code>components × ownership share</code>).</li>
            <li>The <b>Dashboard</b>, <b>Trends</b>, and each account's <b>history</b>
              all read from that snapshot series — nothing is entered twice.</li>
          </ol>
          <p class="howto-note"><b>Ledgers can optionally count.</b> The Ledgers
            page is a standalone bookkeeping tool (personal loans, cost-of-goods
            tracking, manufactured-spend float). By default a ledger's
            balance does <b>not</b> feed net worth. But you can give a ledger a
            <b>side</b> (asset or liability) and turn on <b>Count in net worth</b>;
            its balance is then folded into net worth faithfully, month by month,
            from its dated entries — a liability adds to Debt, an asset adds to
            Non-Liquid. Because of this, ledger entries now <b>require a date</b>.</p>
        </section>

        <section class="panel" id="ht-topbar">
          <h2>The top bar</h2>
          <p>Present on every page:</p>
          <ul>
            <li><b>PFi logo</b> — the app name (top left).</li>
            <li><b>Navigation</b> — Dashboard, Trends, Monthly Entry, Accounts,
              Ledgers, and How-To. The active page is highlighted. On narrow
              screens these collapse behind a <b>hamburger (☰)</b> button.</li>
            <li><b>About</b> — opens a panel listing the independent version
              number of each module (App, UI, API, Database, Importer).</li>
            <li><b>Version</b> — the current app version, shown next to About.</li>
            <li><b>Update (↑ pill)</b> — appears next to the version only when a
              newer PFi version has been published. Click it (or <b>Check for
              updates</b> in the About panel) to review what's available and
              update in one click: PFi pulls the newest code from GitHub and
              restarts itself. If you launched from the <b>PFi</b> app icon it
              also rebuilds the app. Your data is never touched, and reading the
              update needs no login. Updating needs a clean checkout — if you've
              made local code edits in <code>~/PFi</code>, commit or stash them
              first.</li>
            <li><b>Privacy toggle (eye icon)</b> — hides every dollar value on
              screen so you can screenshot the UI without revealing balances.
              Click to blur HTML numbers and mask chart axis / donut numbers
              (shown as <code>•••••</code>); the layout, labels, and chart shapes
              stay visible. Click again to reveal. The setting is remembered and
              applied before the page paints, so values never flash.</li>
            <li><b>Theme toggle (sun/moon)</b> — switches light / dark mode.
              Remembered across sessions; defaults to your OS preference.</li>
            <li><b>Quit (power icon)</b> — stops the local PFi server running on
              your Mac. It asks to confirm first; your data is saved on disk, so
              you can relaunch any time from the <b>PFi</b> app icon. After it
              stops you'll see a "PFi has stopped" screen and can close the tab.
              (You can also stop it from the Terminal with
              <code>~/PFi/shutdown.sh</code>.)</li>
          </ul>
        </section>

        <section class="panel" id="ht-dashboard">
          <h2>Dashboard</h2>
          <p>Your at-a-glance summary, built from the latest snapshot and the
            full history.</p>
          <ul>
            <li><b>KPI cards</b> — Net Worth, Liquid, Non-Liquid, and Debt for the
              most recent month. Each shows a <b>delta</b> versus the prior month
              (▲/▼ with the dollar and percent change). The fifth card,
              <b>12-Month Change</b>, compares against the month ~one year ago.</li>
            <li><b>Net Worth Over Time</b> — an area+line chart of net worth.
              Use the <b>1Y / 3Y / 5Y / ALL</b> range tabs to zoom. Hover anywhere
              to see that month's date, net worth, and month-over-month change in
              a tooltip.</li>
            <li><b>Current Holdings</b> — every account with a non-zero balance,
              grouped into Liquid / Non-Liquid / Debts with a subtotal per group,
              plus a <b>Ledgers</b> group for any ledger that counts toward net
              worth. Click the <b>Account</b>, <b>Class</b>, or <b>Value</b> column
              header to sort (click again to reverse). The <b>MoM Δ</b> column shows
              each row's change versus last month (▲/▼ with dollar and percent, same
              as the KPI cards); rows that didn't exist last month show a <b>New</b>
              pill, and the group subtotal rows show the whole group's
              month-over-month change. (Debt APRs live in the Debt Overview, not
              here.) <b>Click an account row</b> to open its edit/history modal, or a
              <b>ledger row</b> to jump to the Ledgers page.</li>
            <li><b>Asset Allocation</b> — a donut of assets by asset class, with a
              legend showing each class's dollar amount and percentage. Real estate
              is shown <b>net of its linked mortgage</b> (see Concepts), so the
              center total is <b>assets minus property loans</b> — not gross assets
              and not net worth. Hover the center for the exact breakdown. Other
              (unlinked) debt is excluded from this view. <b>Recolor a class</b> by
              clicking its legend swatch (a color picker) — the choice is saved in
              your browser and applies to the Trends charts too; <b>Reset colors</b>
              restores the defaults.</li>
            <li><b>Debt Overview</b> — a focused look at everything you owe, shown
              in the right column under Asset Allocation. Four stats up top:
              <b>Total Debt</b>, the balance-<b>weighted average APR</b> (across
              debts that carry a rate), <b>Cash</b> (your cash-class accounts), and
              the <b>Cash / Debt</b> ratio. Below that, a <b>Fixed vs Variable</b>
              split bar (by balance, each side showing its own average APR), then a
              <b>sortable</b> table (click a header) where each debt's <b>bar length
              is its balance</b> and its <b>color is the rate type</b> (blue = Fixed,
              amber = Variable, grey = unset), alongside its <b>M/M Δ</b>
              (month-over-month <b>dollar</b> change — green when a debt shrinks,
              red when it grows; the percent change lives in Current Holdings),
              rate, and share of total debt. Set a debt's Fixed/Variable in
              its account editor (<b>Rate type</b>). Click any row to open that debt.
              <b>Liability ledgers</b> that count toward net worth appear here too,
              marked <b>Ledger</b> (they have no rate and never affect the weighted
              APR); click one to open the Ledgers page. Toggle whether a ledger
              counts on the Ledgers page itself.</li>
            <li><b>Monthly Notes</b> — a log of every month that has a note (see
              Monthly Entry → Notes), newest first. Each entry shows the month, its
              net worth, the <b>month-over-month change</b> (amount + %), and the
              note; <b>click one to jump</b> straight to that month in Monthly
              Entry.</li>
          </ul>
        </section>

        <section class="panel" id="ht-trends">
          <h2>Trends</h2>
          <p>Long-run analytical views, all driven by the same monthly snapshots
            and controlled by one shared <b>1Y / 3Y / 5Y / ALL</b> range selector
            at the top. Every chart has a hover tooltip. A <b>Show:</b> row of
            checkboxes below the range tabs lets you hide any trend you don't want
            to see; your choices are remembered per browser.</p>
          <ul>
            <li><b>Assets &amp; Debts Over Time</b> — a stacked area chart: Liquid
              and Non-Liquid stacked above the zero line, Debt drawn below it.</li>
            <li><b>Liquid vs Non-Liquid</b> — both series as lines, plus a dashed
              <b>6-month moving average</b> on the Liquid line to smooth noise.</li>
            <li><b>Net Worth &amp; Trend</b> — net worth with a dashed linear
              <b>trendline</b> and its R² (how well the straight line fits). The
              hover tooltip also shows that month's note, when one exists.</li>
            <li><b>Allocation Drift</b> — a 100%-stacked area showing each asset
              class as a share of total assets over time (real estate shown net of
              its linked mortgage).</li>
            <li><b>Debt Paydown &amp; Real-Estate Equity</b> — total debt,
              mortgages only, and net real-estate equity (property value minus the
              linked mortgage) on one chart.</li>
            <li><b>Net Worth — Month by Month</b> — a table of every snapshot in the
              selected range: Liquid, Non-Liquid, Debts, Net Worth, and the
              month-over-month <b>$ Change</b> and <b>% Change</b> (green up / red
              down, like the KPI cards). Click any <b>column header</b> to sort by
              it (click again to reverse); click a <b>row</b> to jump to that month
              in Monthly Entry.</li>
          </ul>
        </section>

        <section class="panel" id="ht-monthly">
          <h2>Monthly Entry</h2>
          <p>Where you record each month's balances. This is the one page you use
            routinely.</p>
          <ul>
            <li><b>Months list</b> — every snapshot, newest first, with its net
              worth. Click one to load it for viewing or editing.</li>
            <li><b>+ New month</b> — prompts for a date (use the 1st, e.g.
              <code>2026-06-01</code>) and creates a snapshot <b>seeded from the
              latest month</b>, so you only change what moved.</li>
            <li><b>Notes</b> — a free-text box above the table for recording
              <i>why</i> anything moved sharply this month (sold an asset, a bonus
              landed, a market drop). It saves with the month. Months that have a
              note show a small ✎ marker and an accent stripe in the list, reveal
              the note on hover, and surface it in the Net Worth chart tooltips on
              both the Dashboard and Trends, plus the Dashboard's <b>Monthly Notes</b>
              log (which links back here).</li>
            <li><b>Editor table</b> — accounts grouped into Liquid / Non-Liquid /
              Debts. Type each account's value for the month. Enter debts as
              positive numbers.</li>
            <li><b>Component accounts</b> — show each component on its own indented
              row (type the full value of each). The parent row displays the
              running sum automatically.</li>
            <li><b>Ownership share slider</b> — for joint accounts, shows the full
              total, a slider for "% is mine", and updates the owned amount live.
              Only your share counts toward net worth.</li>
            <li><b>Review checklist</b> — the small dot beside each value is a
              "reviewed" marker. It turns green automatically when you edit a
              value, or click it to confirm a row whose number didn't change. The
              <b>x / y reviewed</b> counter tracks your progress; <b>Clear
              checks</b> resets them. (This is a personal aid stored in your
              browser — it isn't saved to the database.)</li>
            <li><b>Save</b> — writes all values, component values, and shares for
              the month, then recomputes net worth.</li>
            <li><b>Delete month</b> — removes the entire snapshot (asks first).</li>
          </ul>
        </section>

        <section class="panel" id="ht-accounts">
          <h2>Accounts</h2>
          <p>The master list of everything you track. Define accounts here once;
            their values are entered per month under Monthly Entry.</p>
          <ul>
            <li><b>Account cards</b> — grouped by Liquid / Non-Liquid / Debts. Each
              card shows the name, an asset-class tag, and metadata (institution,
              subtype, APR for debts, and a ↔ link to a mortgage where set).</li>
            <li><b>+ Add account</b> — opens the editor to create a new one.</li>
            <li><b>Closed accounts</b> — a collapsible section (Show/Hide) for
              accounts you've closed; their history is preserved.</li>
          </ul>
          <h3>The account editor (modal)</h3>
          <p>Click any card (or any Dashboard holdings row) to open it:</p>
          <ul>
            <li><b>Name</b>, <b>Group</b>, and <b>Asset class</b> — the essentials.</li>
            <li><b>Institution</b> and <b>Subtype</b> — optional labels; the
              subtype box suggests common types for the chosen class (e.g. Roth
              IRA, Mortgage), but accepts free text.</li>
            <li><b>APR</b> — appears only for Debt accounts (enter as a decimal,
              e.g. <code>0.0275</code> for 2.75%).</li>
            <li><b>Rate type</b> — appears only for Debt accounts; mark the rate
              <b>Fixed</b> or <b>Variable</b> (or leave unset). Feeds the Dashboard's
              Debt Overview split and bar colors.</li>
            <li><b>Linked mortgage</b> — appears only for Real Estate accounts;
              pick the debt account that finances it to enable net-equity views.</li>
            <li><b>Notes</b> — free text.</li>
            <li><b>Components</b> — add, rename, or remove the subaccounts that make
              up this account, and set the ownership share. Components store full
              values; the share determines how much counts toward net worth.</li>
            <li><b>History</b> — a mini net-worth line chart for this account plus a
              month-by-month value table.</li>
            <li><b>Close / Reopen account</b> — closing keeps all history but stops
              the account from appearing in new monthly entries. You can reopen
              later.</li>
          </ul>
          <p class="howto-note"><b>Never relabel an old account.</b> If something
            changes (you switch banks, an account becomes a different thing),
            <b>close</b> the old one and <b>add</b> a new one. Renaming rewrites
            history and makes past months misleading.</p>
        </section>

        <section class="panel" id="ht-ledgers">
          <h2>Ledgers</h2>
          <p>Standalone sub-ledgers for detailed bookkeeping that doesn't belong
            in the monthly snapshot — for example personal loans, cost-of-goods
            tracking, or manufactured-spend float.</p>
          <ul>
            <li><b>Ledger tabs</b> — switch between ledgers; each tab shows its
              name and current balance.</li>
            <li><b>Side &amp; Count in net worth</b> — set a ledger's <b>side</b>
              (asset or liability) and tick <b>Count in net worth</b> to fold its
              balance into net worth (liability → Debt, asset → Non-Liquid).</li>
            <li><b>Entries table</b> — every line with its date, label, note,
              amount, and a <b>running balance</b>. Negative amounts show in red.
              <b>Click a column header to sort</b> (rows keep their chronological
              running balance).</li>
            <li><b>Add a row</b> — fill the bottom row and click <b>Add</b>. A
              <b>date is required</b> on every entry.</li>
            <li><b>Delete a row</b> — the ✕ at the end of each row removes it.</li>
          </ul>
          <p class="howto-note">When a ledger counts toward net worth, its
            balance is computed <b>faithfully per month</b> from the entries dated
            on or before each snapshot — so a ledger added today still shows the
            right historical balance in past months. Ledgers left with Count off
            stay purely informational.</p>
        </section>

        <section class="panel" id="ht-workflows">
          <h2>Common workflows</h2>
          <h3>Your monthly routine</h3>
          <ol>
            <li>Go to <b>Monthly Entry</b> → <b>+ New month</b> (it copies last
              month's values).</li>
            <li>Update each balance that changed; use the review dots to track
              what you've confirmed.</li>
            <li><b>Save</b>, then check the <b>Dashboard</b> to see the new net
              worth and deltas.</li>
          </ol>
          <h3>Adding a new account mid-stream</h3>
          <ol>
            <li><b>Accounts</b> → <b>+ Add account</b>; set name, group, class, and
              any details.</li>
            <li>Open <b>Monthly Entry</b> for the current month and enter its
              balance (older months stay at zero, which is correct).</li>
          </ol>
          <h3>A joint account</h3>
          <ol>
            <li>Open the account, add its <b>components</b> (or one component for
              the whole balance).</li>
            <li>Set the <b>ownership share</b> to your percentage; only your share
              counts toward net worth.</li>
          </ol>
          <h3>Real estate with a mortgage</h3>
          <ol>
            <li>Add the property as a <b>Real Estate</b> (Non-Liquid) account and
              the loan as a <b>Debt</b> account.</li>
            <li>On the property, set <b>Linked mortgage</b> to that debt to unlock
              net-equity charts in Trends.</li>
          </ol>
          <h3>Taking a screenshot</h3>
          <ol>
            <li>Click the <b>eye icon</b> in the top bar to hide all values.</li>
            <li>Screenshot; the layout and charts stay visible while numbers are
              masked. Click the eye again to reveal.</li>
          </ol>
        </section>

        <section class="panel" id="ht-tips">
          <h2>Tips &amp; gotchas</h2>
          <ul>
            <li><b>Enter debts as positive numbers</b> — PFi subtracts them
              automatically.</li>
            <li><b>Close, don't rename</b> — preserve the meaning of past months.</li>
            <li><b>Components hold full values</b> — the ownership share, not the
              numbers you type, decides what counts.</li>
            <li><b>Zero is meaningful</b> — a $0 month for an account means "no
              balance then," and is excluded from its history chart.</li>
            <li><b>Review checks are local</b> — they live in your browser, not the
              database, so they won't sync to another device.</li>
            <li><b>Privacy mode is for screenshots only</b> — it hides values
              visually; it does not encrypt or restrict the data.</li>
            <li><b>Your data is sensitive and local</b> — only expose PFi on a
              network you trust, and never commit or share the database or TLS
              keys. They live in <code>~/Library/Application&nbsp;Support/PFi/</code>,
              outside the shareable app.</li>
          </ul>
        </section>

        <section class="panel" id="ht-maint">
          <h2>Keeping this guide current</h2>
          <p>This page is part of the app, not an afterthought. Whenever a page,
            control, field, or behavior changes, the matching section here is
            updated in the same change, and the "Guide revised" date at the top is
            bumped. If something on screen doesn't match what you read here,
            the guide is the bug.</p>
        </section>

      </div>
    </div>`;

  // Smooth-scroll the table of contents to each section.
  document.getElementById("htToc").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-to]");
    if (!a) return;
    e.preventDefault();
    const target = document.getElementById(a.dataset.to);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
