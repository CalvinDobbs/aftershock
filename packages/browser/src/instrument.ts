import type { ConsoleEntry, NetworkSummary } from "@aftershock/schema/browser";

/**
 * In-page instrumentation for network and console evidence.
 *
 * The obvious route is Browserbase's session logs, and that is what this
 * originally used. Measured against a live session it returns zero entries —
 * during the run, four seconds later, and after the session closes — so every
 * step was recording `requestCount: 0`, which reads as "the app made no
 * requests" when it means "we never looked". Stagehand v4 exposes no CDP
 * session and only a `console` page event, so there is no network hook to
 * subscribe to either.
 *
 * Instead the page instruments itself. An init script runs before any app code
 * on every document, wraps `fetch` and `XMLHttpRequest`, and records what the
 * app actually asked for. After each step the harness drains the buffer.
 *
 * What this sees: every call the application makes. What it does not:
 *
 *   - Document navigations, images, styles and scripts. The browser issues
 *     those itself. That is the right trade — a QA finding turns on whether
 *     the app called its own API and what came back, not on font loads.
 *   - Requests still in flight when a full page navigation replaces the
 *     document. The buffer lives on `window`, so the old document's tail is
 *     lost. Client-side route changes are unaffected, and the settle in the
 *     harness closes most of the rest.
 *   - Iframes. Only the top frame's buffer is drained, so an embedded widget's
 *     traffic is invisible. Fine for the apps we test today; if that changes,
 *     the drain has to walk frames.
 */

/** Where the buffer lives on the page. Namespaced so an app cannot collide. */
export const EVIDENCE_KEY = "__aftershockEvidence__";

/** Bounded so a polling app cannot grow the buffer without limit. */
const MAX_ENTRIES = 200;

export const INSTRUMENT_SCRIPT = `
(() => {
  var KEY = ${JSON.stringify(EVIDENCE_KEY)};
  var MAX = ${MAX_ENTRIES};
  if (window[KEY]) return;            // init scripts can run more than once

  var store = { net: [], log: [], installed: true };
  window[KEY] = store;

  // A ring, not a cap. Dropping the newest meant a polling page filled the
  // buffer with poll traffic and discarded the request the action actually
  // caused, which is the only one anybody wanted.
  function push(list, entry) {
    list.push(entry);
    if (list.length > MAX) list.shift();
  }

  // Counted separately so a busy page reports how much it really did rather
  // than the size of the window we kept.
  function isAbort(error) {
    return !!error && (error.name === "AbortError" || /abort/i.test(error.message || ""));
  }

  function absolute(url) {
    try { return new URL(url, document.baseURI).toString(); } catch (_) { return String(url); }
  }

  // --- fetch -------------------------------------------------------------
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (input, init) {
      var started = Date.now();
      var method = (init && init.method) ||
        (input && typeof input === "object" && input.method) || "GET";
      var url = absolute(
        typeof input === "string" ? input : (input && input.url) || String(input)
      );
      return nativeFetch.apply(this, arguments).then(
        function (response) {
          push(store.net, {
            method: String(method).toUpperCase(),
            url: url,
            status: response.status,
            durationMs: Date.now() - started,
          });
          return response;
        },
        function (error) {
          // An abort is the application cancelling its own request — an
          // effect cleanup, a superseded search. Recording it as a failure
          // produced one-sided phantom regressions that depended on timing.
          push(store.net, {
            method: String(method).toUpperCase(),
            url: url,
            durationMs: Date.now() - started,
            aborted: isAbort(error) || undefined,
            errorText: isAbort(error) ? undefined : (error && error.message) || "fetch failed",
          });
          throw error;
        }
      );
    };
  }

  // --- XMLHttpRequest ----------------------------------------------------
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var open = XHR.prototype.open;
    var send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__as_method = String(method || "GET").toUpperCase();
      this.__as_url = absolute(url);
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var self = this;
      var started = Date.now();
      // A reused XHR calls send() more than once; adding the listener each
      // time double-recorded every later request with a stale duration.
      if (!self.__as_bound) {
        self.__as_bound = true;
        self.addEventListener("loadend", function () {
          var aborted = self.__as_aborted;
          self.__as_aborted = false;
          push(store.net, {
            method: self.__as_method || "GET",
            url: self.__as_url || "",
            status: self.status || undefined,
            durationMs: Date.now() - self.__as_started,
            aborted: aborted || undefined,
            errorText: self.status || aborted ? undefined : "request failed",
          });
        });
        self.addEventListener("abort", function () { self.__as_aborted = true; });
      }
      self.__as_started = started;
      return send.apply(this, arguments);
    };
  }

  // --- console -----------------------------------------------------------
  ["error", "warn"].forEach(function (level) {
    var native = console[level];
    console[level] = function () {
      try {
        var text = Array.prototype.map
          .call(arguments, function (a) {
            if (typeof a === "string") return a;
            if (a instanceof Error) return a.message;
            try { return JSON.stringify(a); } catch (_) { return String(a); }
          })
          .join(" ");
        push(store.log, { level: level, text: text, timestamp: Date.now() });
      } catch (_) { /* never break the app to record it */ }
      return native.apply(this, arguments);
    };
  });

  // Uncaught failures are the strongest console signal and never reach
  // console.error on their own.
  window.addEventListener("error", function (event) {
    push(store.log, {
      level: "error",
      text: (event && event.message) || "uncaught error",
      timestamp: Date.now(),
    });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    push(store.log, {
      level: "error",
      text: "unhandled rejection: " + ((reason && reason.message) || String(reason)),
      timestamp: Date.now(),
    });
  });
})();
`;

/** Drains the buffer and empties it, so each step reports only its own activity. */
const DRAIN_SCRIPT = `
(() => {
  var store = window[${JSON.stringify(EVIDENCE_KEY)}];
  if (!store) return { installed: false, net: [], log: [] };
  var net = store.net.splice(0);
  var log = store.log.splice(0);
  return { installed: true, net: net, log: log };
})()
`;

interface DrainResult {
  installed: boolean;
  net: {
    method: string;
    url: string;
    status?: number;
    durationMs?: number;
    errorText?: string;
    aborted?: boolean;
  }[];
  log: { level: string; text: string; timestamp: number }[];
}

/** Anything a page under test can observe. Enough for one page to be a session. */
export interface EvidencePage {
  evaluate<R = unknown>(expression: string): Promise<R>;
}

export async function drainPageEvidence(
  page: EvidencePage,
): Promise<{ network: NetworkSummary; console: ConsoleEntry[] }> {
  /** Nothing observed, and saying so. */
  const uncaptured = {
    network: { requestCount: 0, requests: [], failedRequests: [], captured: false },
    console: [],
  };

  let result: DrainResult | undefined;
  try {
    result = await page.evaluate<DrainResult>(DRAIN_SCRIPT);
  } catch {
    // A navigation mid-drain, a cross-origin document, a closed page.
    return uncaptured;
  }

  // The init script never ran: a document the browser owns, or a session
  // opened without instrumentation.
  if (!result?.installed) return uncaptured;

  const requests = result.net ?? [];
  return {
    network: {
      requestCount: requests.length,
      requests,
      // A 4xx or 5xx is a failure the app has to handle; a transport error is
      // one it never got a chance to.
      failedRequests: requests.filter(
        (r) => !r.aborted && (r.errorText !== undefined || (r.status ?? 0) >= 400),
      ),
      captured: true,
    },
    console: (result.log ?? []).map((entry) => ({
      level: entry.level,
      text: entry.text,
      timestamp: entry.timestamp,
    })),
  };
}
