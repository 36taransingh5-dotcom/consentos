import { dataTypeNoun, purposeActivity } from "@consentos/policy-engine";
import type { EventSummary, ExtensionState, PendingSummary } from "@consentos/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchState, resolveRequest, revokeGrant } from "../lib/api";
import { hostOf, relativeTime } from "../lib/logic";
import type { Connection, TabService } from "../lib/messages";
import { getApiUrl, getConnection, getTabService, setApiUrl, setConnection } from "../lib/storage";
import { Back, Check, Cross, Gear, Globe, Mark } from "./icons";

interface TabContext {
  host: string | null;
  service: TabService | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "disconnected"; apiUrl: string; reason?: string }
  | { kind: "error"; apiUrl: string; message: string }
  | { kind: "ready"; connection: Connection; state: ExtensionState; tab: TabContext };

/** Scene order: what matters most first. */
const RULE_ORDER = [
  "foundationModelTraining",
  "advertising",
  "thirdPartySharing",
  "personalization",
  "preciseLocation",
  "analytics",
  "essential",
];

const BRAND: Record<string, string> = { pixly: "#ff5a4e" };

function open(url: string) {
  void chrome.tabs.create({ url });
  window.close();
}

/**
 * The tab the popup describes: normally the active tab. `popup.html?tabId=N`
 * pins it to a specific tab, which lets automated tests open the popup as a
 * page while still describing the site under test.
 */
async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const pinned = Number(new URLSearchParams(window.location.search).get("tabId"));
  if (Number.isInteger(pinned) && pinned > 0) return chrome.tabs.get(pinned).catch(() => undefined);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadPhase(): Promise<Phase> {
  const tab = await targetTab();
  const service = tab?.id !== undefined ? await getTabService(tab.id) : null;
  const apiUrl = await getApiUrl();
  const connection = await getConnection();
  if (!connection) return { kind: "disconnected", apiUrl };
  try {
    const state = await fetchState(connection, service ? { serviceId: service.serviceId, origin: service.origin } : undefined);
    return { kind: "ready", connection, state, tab: { host: hostOf(tab?.url), service } };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await setConnection(null);
      return { kind: "disconnected", apiUrl, reason: "Your session ended. Connect again to keep your rules in sync." };
    }
    return { kind: "error", apiUrl, message: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [view, setView] = useState<"main" | "settings">("main");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => loadPhase().then(setPhase), []);

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "popup-opened" }).catch(() => undefined);
    let cancelled = false;
    const tick = () =>
      void loadPhase().then((next) => {
        if (!cancelled) setPhase(next);
      });
    tick();
    // While the popup is open it mirrors ConsentOS live.
    const interval = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const act = async (id: string, fn: (c: Connection) => Promise<unknown>) => {
    if (phase.kind !== "ready") return;
    setBusy(id);
    setActionError(null);
    try {
      await fn(phase.connection);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  if (view === "settings") {
    return <Settings onBack={() => setView("main")} onSaved={() => void refresh()} />;
  }

  return (
    <div className="app">
      <header className="header">
        <span className="brand">
          <Mark />
          ConsentOS
        </span>
        {phase.kind === "ready" && (
          <span className="who" title={`Connected as ${phase.state.user.email}`}>
            <span className="live" aria-hidden="true" />
            <span>{phase.state.user.email}</span>
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          style={phase.kind === "ready" ? undefined : { marginLeft: "auto" }}
          aria-label="Settings"
          onClick={() => setView("settings")}
        >
          <Gear />
        </button>
      </header>

      {phase.kind === "loading" && <Loading />}

      {phase.kind === "disconnected" && (
        <div className="center">
          <Mark />
          <h1>Connect ConsentOS</h1>
          <p>
            {phase.reason ??
              "Sign in once so the extension can show — and help enforce — your rules on every site that integrates ConsentOS."}
          </p>
          <button type="button" className="btn primary full" onClick={() => open(`${phase.apiUrl}/extension/connect`)}>
            Connect
          </button>
          <p className="server">Server: {phase.apiUrl}</p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="center">
          <Mark />
          <h1>Can&apos;t reach ConsentOS</h1>
          <p>{phase.message}. Your rules still apply on the server; this view will refresh when it&apos;s back.</p>
          <button type="button" className="btn full" onClick={() => void refresh()}>
            Try again
          </button>
          <p className="server">Server: {phase.apiUrl}</p>
        </div>
      )}

      {phase.kind === "ready" && (
        <Ready
          phase={phase}
          busy={busy}
          actionError={actionError}
          onRevoke={(receiptId) => void act(receiptId, (c) => revokeGrant(c, receiptId))}
          onResolve={(p, decision) => void act(p.requestId, (c) => resolveRequest(c, p.requestId, decision))}
        />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="body" aria-busy="true" aria-label="Loading">
      <div className="card">
        <div className="site">
          <span className="avatar skeleton" />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 14, width: "50%" }} />
            <div className="skeleton" style={{ height: 10, width: "70%", marginTop: 6 }} />
          </div>
        </div>
        <div className="skeleton" style={{ height: 52, marginTop: 14 }} />
        <div className="skeleton" style={{ height: 12, width: "80%", marginTop: 14 }} />
        <div className="skeleton" style={{ height: 12, width: "65%", marginTop: 10 }} />
      </div>
    </div>
  );
}

function eventPill(event: EventSummary): { tone: string; text: string } {
  switch (event.type) {
    case "consent.denied":
      return { tone: "block", text: "Blocked" };
    case "enforcement.blocked":
      return { tone: "block", text: "Refused" };
    case "consent.allowed":
      return { tone: "allow", text: "Allowed" };
    case "consent.pending":
      return { tone: "ask", text: "Needs you" };
    case "consent.resolved":
      return event.decision === "ALLOW" ? { tone: "allow", text: "Allowed" } : { tone: "block", text: "Declined" };
    case "grant.revoked":
      return { tone: "neutral", text: "Revoked" };
    default:
      return { tone: "neutral", text: "Updated" };
  }
}

function LatestEvent({ event }: { event: EventSummary }) {
  const pill = eventPill(event);
  return (
    <div>
      <p className="eyebrow">
        Latest · <span className="event-time">{relativeTime(event.createdAt)}</span>
      </p>
      <div className="event">
        <p>{event.message}</p>
        <span className={`pill ${pill.tone}`}>{pill.text}</span>
      </div>
    </div>
  );
}

function Rules({ state }: { state: ExtensionState }) {
  const rows = [...state.policy.rows].sort((a, b) => RULE_ORDER.indexOf(a.key) - RULE_ORDER.indexOf(b.key));
  return (
    <div className="card rules">
      <div className="rules-head">
        <h2 className="rules-title">Your Privacy Rules</h2>
        <span className="event-time">v{state.policy.version}</span>
      </div>
      <ul className="list">
        {rows.map((row) => (
          <li key={row.key} className="row">
            <span className="label">{row.label}</span>
            <span className={`tag ${row.display === "ANONYMOUS ONLY" ? "ANON" : row.display}`}>
              {row.display === "ANONYMOUS ONLY" ? "ANON ONLY" : row.display}
            </span>
          </li>
        ))}
        <li className="row">
          <span className="label">Retention limit</span>
          <span className="tag DAYS">{state.policy.maxRetentionDays} days</span>
        </li>
      </ul>
    </div>
  );
}

function Pending({
  items,
  busy,
  onResolve,
}: {
  items: PendingSummary[];
  busy: string | null;
  onResolve: (p: PendingSummary, decision: "ALLOW" | "DENY") => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="card pending">
      <p className="eyebrow" style={{ color: "var(--ask)" }}>
        Needs your answer
      </p>
      {items.map((p) => (
        <div key={p.requestId} className="pending-item">
          <p>
            <strong>{p.serviceName}</strong> wants to use your {dataTypeNoun(p.dataType)} for{" "}
            <strong>{purposeActivity(p.purpose)}</strong>
            {p.retentionDays !== null ? `, kept ${p.retentionDays} days` : ""}.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            {p.reason}
          </p>
          <div className="pending-actions">
            <button type="button" className="btn" disabled={busy === p.requestId} onClick={() => onResolve(p, "DENY")}>
              Decline
            </button>
            <button type="button" className="btn primary" disabled={busy === p.requestId} onClick={() => onResolve(p, "ALLOW")}>
              Allow
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Ready({
  phase,
  busy,
  actionError,
  onRevoke,
  onResolve,
}: {
  phase: Extract<Phase, { kind: "ready" }>;
  busy: string | null;
  actionError: string | null;
  onRevoke: (receiptId: string) => void;
  onResolve: (p: PendingSummary, decision: "ALLOW" | "DENY") => void;
}) {
  const { state, tab, connection } = phase;
  const site = state.site;
  const verified = site?.originVerified === true;
  const apiUrl = connection.apiUrl;

  const footer = (
    <footer className="footer">
      <button type="button" className="btn" onClick={() => open(`${apiUrl}/policy`)}>
        View policy
      </button>
      {site && verified ? (
        <button
          type="button"
          className="btn primary"
          disabled={!site.latestReceiptId}
          onClick={() => site.latestReceiptId && open(`${apiUrl}/receipts/${site.latestReceiptId}`)}
        >
          View receipt
        </button>
      ) : (
        <button type="button" className="btn primary" onClick={() => open(`${apiUrl}/receipts`)}>
          All receipts
        </button>
      )}
    </footer>
  );

  // A page that announced a registered service from the wrong origin.
  if (site && !verified) {
    return (
      <>
        <div className="body">
          <div className="card warning" role="alert">
            <p className="eyebrow" style={{ color: "var(--ask)" }}>
              Unverified claim
            </p>
            <p>
              This page says it is <strong>{site.service.name}</strong>, but it isn&apos;t served from {site.service.name}
              &apos;s registered address ({site.service.domain}). ConsentOS won&apos;t treat it as {site.service.name}.
            </p>
          </div>
          <Rules state={state} />
        </div>
        {footer}
      </>
    );
  }

  if (!site) {
    return (
      <>
        <div className="body">
          <div className="card unsupported">
            <p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Globe /> {tab.host ?? "This page"}
            </p>
            <h2>This site has not integrated ConsentOS yet.</h2>
            <p>Your policy remains active for supported services.</p>
          </div>
          <Pending items={state.pending} busy={busy} onResolve={onResolve} />
          <Rules state={state} />
          {state.recentEvents[0] && (
            <div className="card">
              <LatestEvent event={state.recentEvents[0]} />
            </div>
          )}
          {actionError && <p className="error-text">{actionError}</p>}
        </div>
        {footer}
      </>
    );
  }

  const attempted = site.blocked.filter((b) => b.source === "request").length;
  return (
    <>
      <div className="body">
        <div className="card">
          <div className="site">
            <span className="avatar" style={{ background: BRAND[site.service.id] ?? "#3a3a40" }} aria-hidden="true">
              {site.service.name.charAt(0)}
            </span>
            <div style={{ minWidth: 0 }}>
              <p className="site-name">{site.service.name}</p>
              <p className="site-meta">
                {site.service.domain} · {site.service.verified ? "Verified integration" : "Integration"}
              </p>
            </div>
            <span className="pill allow">
              <Check /> Protected
            </span>
          </div>

          <div className="stats">
            <div className="stat allow">
              <strong>{site.grants.length}</strong>
              <span>Allowed</span>
            </div>
            <div className="stat block">
              <strong>{site.blocked.length}</strong>
              <span>{attempted > 0 ? `Blocked · ${attempted} attempted` : "Blocked"}</span>
            </div>
          </div>

          <ul className="list" aria-label={`What ${site.service.name} may do`}>
            {site.grants.map((g) => (
              <li key={g.receiptId} className="row">
                <Check className="allow" />
                <span className="label" title={`${g.dataType}${g.retentionDays !== null ? ` · ${g.retentionDays} days` : ""}`}>
                  {g.purposeLabel}
                </span>
                {g.retentionDays !== null && g.purpose !== "essential" && <span className="hint">{g.retentionDays}d</span>}
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy === g.receiptId}
                  aria-label={`Revoke ${g.purposeLabel}`}
                  onClick={() => onRevoke(g.receiptId)}
                >
                  {busy === g.receiptId ? "…" : "Revoke"}
                </button>
              </li>
            ))}
            {site.blocked.map((b) => {
              const content = (
                <>
                  <Cross className="block" />
                  <span className="label">{b.purposeLabel}</span>
                  {b.attemptedAt && <span className="hint block">tried {relativeTime(b.attemptedAt).toLowerCase()}</span>}
                </>
              );
              return (
                <li key={b.purpose}>
                  {b.receiptId ? (
                    <button type="button" className="row link" onClick={() => open(`${apiUrl}/receipts/${b.receiptId}`)}>
                      {content}
                    </button>
                  ) : (
                    <div className="row">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>

          {site.latestEvent && (
            <>
              <div className="divider" />
              <LatestEvent event={site.latestEvent} />
            </>
          )}
        </div>

        <Pending items={site.pending} busy={busy} onResolve={onResolve} />
        {actionError && <p className="error-text">{actionError}</p>}
        <Rules state={state} />
      </div>
      {footer}
    </>
  );
}

function Settings({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [apiUrl, setUrl] = useState("");
  const [connected, setConnected] = useState<Connection | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getApiUrl(), getConnection()]).then(([url, connection]) => {
      setUrl(url);
      setConnected(connection);
    });
  }, []);

  const save = async () => {
    let origin: string;
    try {
      const url = new URL(apiUrl);
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        setMessage("Use https:// (http is only allowed for localhost).");
        return;
      }
      origin = url.origin;
    } catch {
      setMessage("Enter a full URL, like https://consentos.example");
      return;
    }
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) {
      setMessage("The extension needs permission to talk to that server.");
      return;
    }
    await setApiUrl(origin);
    await setConnection(null);
    setConnected(null);
    setMessage(`Saved. Connect to ${origin} to continue.`);
    onSaved();
  };

  return (
    <div className="app">
      <header className="header">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
          <Back />
        </button>
        <span className="brand">Settings</span>
      </header>
      <div className="body">
        <div className="card">
          <p className="eyebrow">Account</p>
          {connected ? (
            <>
              <p style={{ margin: "6px 0 0" }}>
                Connected as <strong>{connected.user.email}</strong>
              </p>
              <button
                type="button"
                className="btn full"
                style={{ marginTop: 12 }}
                onClick={() =>
                  void setConnection(null).then(() => {
                    setConnected(null);
                    setMessage("Disconnected.");
                    onSaved();
                  })
                }
              >
                Disconnect
              </button>
            </>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Not connected.
            </p>
          )}
        </div>
        <div className="card">
          <p className="eyebrow">ConsentOS server</p>
          <div className="field">
            <label htmlFor="api-url">Server URL</label>
            <input id="api-url" type="url" value={apiUrl} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          </div>
          <button type="button" className="btn primary full" style={{ marginTop: 12 }} onClick={() => void save()}>
            Save server
          </button>
          {message && (
            <p className="muted" role="status" style={{ margin: "10px 0 0", fontSize: 12 }}>
              {message}
            </p>
          )}
        </div>
        <p className="server" style={{ textAlign: "center" }}>
          ConsentOS extension {chrome.runtime.getManifest().version}
        </p>
      </div>
    </div>
  );
}
