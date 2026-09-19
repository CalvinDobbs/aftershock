'use client';

import { useEffect, useRef, useState } from 'react';

import styles from '../../app/prototype/prototype.module.css';
import { PrototypeReplay, type FeedStatus } from './PrototypeReplay';

const STAGES = [
  { id: 'trigger', label: 'Commit', ms: 1800 },
  { id: 'intent', label: 'Intent', ms: 2800 },
  { id: 'browser', label: 'Browser QA', ms: 11000 },
  { id: 'validate', label: 'Confirmed', ms: 3800 },
  { id: 'repair', label: 'Patch', ms: 3800 },
  { id: 'verify', label: 'Verified', ms: 0 },
] as const;

const FEED_ACTIONS: Record<string, string[]> = {
  cart: ['Sign in', 'Add backpack', 'Open cart'],
  inventory: ['Sign in', 'Open Bike Light', 'Back to inventory'],
  checkout: [
    'Sign in',
    'Add onesie',
    'Open cart',
    'Checkout',
    'Customer details',
    'Order overview',
  ],
};

const STAGE_STARTS = STAGES.reduce<number[]>((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1]! + STAGES[i - 1]!.ms);
  return acc;
}, []);

function relTime(index: number): string {
  const s = Math.round((STAGE_STARTS[index] ?? 0) / 1000);
  return `0:${String(s).padStart(2, '0')}`;
}

type AgentState = 'queued' | 'running' | 'attention' | 'done';

/** The rail mark and the message mark are the same disc, so a role is
 *  recognisable in the rail before it has spoken. */
const TONE: Record<string, string> = {
  PL: styles.markPlanner!,
  QA: styles.markQA!,
  VA: styles.markValidator!,
  DX: styles.markDiagnosis!,
  RP: styles.markRepair!,
  VR: styles.markVerifier!,
};

function AgentRow({
  mark,
  name,
  sub,
  state,
  detail,
}: {
  mark: string;
  name: string;
  sub: string;
  state: AgentState;
  detail: string;
}) {
  return (
    <div className={`${styles.agent} ${styles[`agent-${state}`]}`}>
      <span className={`${styles.agentMark} ${TONE[mark] ?? ''}`}>{mark}</span>
      <span className={styles.agentBody}>
        <span className={styles.agentName}>{name}</span>
        <span className={styles.agentSub}>{sub}</span>
      </span>
      <span className={styles.agentState}>{detail}</span>
    </div>
  );
}

export function PrototypeExperience({
  sessions,
}: {
  sessions: { id: string; title: string; sessionId: string }[];
}) {
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(true);
  const [browserElapsed, setBrowserElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  // The thread follows the run the way a chat follows a conversation. Keyed on
  // browserElapsed as well as phase because the Browser QA turn keeps growing
  // after it lands — three feeds reserve their space as each one starts.
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [phase, browserElapsed]);

  useEffect(() => {
    if (!running) return;
    const stage = STAGES[phase];
    if (!stage || stage.ms === 0) return;
    timer.current = setTimeout(() => setPhase((p) => Math.min(p + 1, STAGES.length - 1)), stage.ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, running]);

  useEffect(() => {
    if (phase !== 2 || !running) return;
    const tick = setInterval(() => {
      setBrowserElapsed((e) => Math.min(e + 700, 11000));
    }, 700);
    return () => clearInterval(tick);
  }, [phase, running]);

  const jump = (i: number) => {
    setPhase(i);
    setRunning(false);
    setBrowserElapsed(i >= 2 ? 11000 : 0);
  };

  const restart = () => {
    setPhase(0);
    setBrowserElapsed(0);
    setRunning(true);
  };

  const browserMs = STAGES[2].ms;
  const sessionsRunning = Math.min(3, 1 + Math.floor(browserElapsed / 3600));
  const runStatus = phase >= 5 ? 'Verified' : phase >= 3 ? 'Regression found' : 'Testing';

  const feedMeta = (id: string): { action: string; label: string; status: FeedStatus } => {
    if (phase < 3) {
      const steps = FEED_ACTIONS[id] ?? [];
      const idx = Math.min(steps.length - 1, Math.floor((browserElapsed / browserMs) * steps.length));
      return {
        action: steps[idx] ?? '',
        label: `${Math.min(steps.length, idx + 1)}/${steps.length}`,
        status: 'running',
      };
    }
    if (id === 'cart') {
      return {
        action: phase >= 5 ? 'Verified' : 'Complete',
        label: '3/3',
        status: phase >= 5 ? 'verified' : 'finding',
      };
    }
    return {
      action: phase >= 5 ? 'Passed' : 'Complete',
      label: `${(FEED_ACTIONS[id] ?? []).length}/${(FEED_ACTIONS[id] ?? []).length}`,
      status: 'passed',
    };
  };

  const progress = Math.min(
    100,
    Math.round(((phase + (phase === 2 ? browserElapsed / browserMs : 0)) / (STAGES.length - 1)) * 100),
  );

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>AFTERSHOCK</span>
        <span className={styles.ctx}>acme/storefront · PR #1842 · 9c8e2a1</span>
        <span className={styles.ctxTitle}>Persist cart state across route navigation</span>
        <span className={styles.disclosure}>MOCK PIPELINE · REAL BROWSERS</span>
        <button className={styles.ghostBtn} onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Continue'}
        </button>
        <button className={styles.ghostBtn} onClick={restart}>
          Restart
        </button>
      </header>

      <div className={styles.body}>
        <aside className={styles.rail}>
          <div className={styles.railHead}>
            <span className={styles.label}>RUN STATUS</span>
            <span
              className={`${styles.railStatus} ${
                phase >= 5 ? styles.ok : phase >= 3 ? styles.bad : styles.work
              }`}
            >
              {runStatus}
            </span>
          </div>
          <div className={styles.agents}>
            <AgentRow
              mark="PL"
              name="Planner"
              sub="Intent analysis"
              state={phase >= 2 ? 'done' : phase >= 1 ? 'running' : 'queued'}
              detail={phase >= 2 ? '3 checks' : phase >= 1 ? 'mapping' : 'queued'}
            />
            <AgentRow
              mark="QA"
              name="Browser QA"
              sub="3 sessions"
              state={phase >= 5 ? 'done' : phase >= 2 ? 'running' : 'queued'}
              detail={
                phase >= 5
                  ? 'passed'
                  : phase >= 3
                    ? '1 finding'
                    : phase >= 2
                      ? `${sessionsRunning}/3 running`
                      : 'queued'
              }
            />
            <AgentRow
              mark="VA"
              name="Validator"
              sub="Finding validation"
              state={phase >= 4 ? 'done' : phase >= 3 ? 'attention' : 'queued'}
              detail={phase >= 4 ? 'confirmed' : phase >= 3 ? '94%' : 'queued'}
            />
            <AgentRow
              mark="DX"
              name="Diagnosis"
              sub="Root cause"
              state={phase >= 5 ? 'done' : phase >= 4 ? 'running' : 'queued'}
              detail={phase >= 5 ? 'found' : phase >= 4 ? 'tracing' : 'queued'}
            />
            <AgentRow
              mark="RP"
              name="Repair"
              sub="Patch generation"
              state={phase >= 5 ? 'done' : phase >= 4 ? 'running' : 'queued'}
              detail={phase >= 5 ? 'prepared' : phase >= 4 ? 'drafting' : 'queued'}
            />
            <AgentRow
              mark="VR"
              name="Verifier"
              sub="Fix replay"
              state={phase >= 5 ? 'done' : 'queued'}
              detail={phase >= 5 ? '3/3' : 'queued'}
            />
          </div>
          <div className={styles.legend}>
            <span>Pipeline simulated</span>
            <span>Browser sessions real</span>
            <span className={styles.legendNote}>
              Live View while running; replay after completion.
            </span>
          </div>
        </aside>

        <main className={styles.room}>
          <div className={styles.stageRail}>
            <div className={styles.stages}>
              {STAGES.map((s, i) => (
                <button
                  key={s.id}
                  className={`${styles.stage} ${
                    i < phase ? styles.stageDone : i === phase ? styles.stageActive : ''
                  }`}
                  onClick={() => jump(i)}
                >
                  <span className={styles.stageDot}>{i < phase ? '✓' : ''}</span>
                  {s.label}
                </button>
              ))}
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className={styles.thread}>
            <div className={styles.systemLine}>Commit 9c8e2a1 received from PR #1842.</div>

            {phase >= 1 && (
              <div className={`land ${styles.msg}`}>
                <span className={`${styles.mark} ${styles.markPlanner}`}>PL</span>
                <div className={styles.msgBody}>
                  <div className={styles.msgHead}>
                    <span className={styles.msgRole}>Planner</span>
                    <span className={styles.msgFn}>Intent analysis</span>
                    <span className={styles.msgTime}>{relTime(1)}</span>
                  </div>
                  <div className={styles.bubble}>
                    <p className={styles.msgText}>Mapped the cart change into three user flows.</p>
                    <p className={styles.claim}>
                      Cart quantity must survive navigation to /cart.
                    </p>
                    <div className={styles.chips}>
                      <span className={styles.chip}>Sign in</span>
                      <span className={styles.chip}>Add item</span>
                      <span className={styles.chip}>Open cart</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {phase >= 2 && (
              <div className={`land ${styles.msg}`}>
                <span className={`${styles.mark} ${styles.markQA}`}>QA</span>
                <div className={styles.msgBody}>
                  <div className={styles.msgHead}>
                    <span className={styles.msgRole}>Browser QA</span>
                    <span className={styles.msgFn}>3 sessions</span>
                    <span className={styles.msgTime}>{relTime(2)}</span>
                  </div>
                  <div className={styles.bubble}>
                    <p className={styles.msgText}>
                      Running the same journey on preview and main.
                    </p>
                    <div className={styles.fleet}>
                      <div className={styles.fleetHead}>BROWSER FLEET · 3 / 3 SESSIONS</div>
                      <div className={styles.fleetGrid}>
                        {sessions.map((s) => {
                          const meta = feedMeta(s.id);
                          return (
                            <PrototypeReplay
                              key={s.id}
                              sessionId={s.sessionId}
                              active={phase >= 2}
                              title={s.title}
                              currentAction={meta.action}
                              progressLabel={meta.label}
                              status={meta.status}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {phase >= 3 && (
              <div className={`land ${styles.msg}`}>
                <span className={`${styles.mark} ${styles.markValidator}`}>VA</span>
                <div className={styles.msgBody}>
                  <div className={styles.msgHead}>
                    <span className={styles.msgRole}>Validator</span>
                    <span className={styles.msgFn}>Finding validation</span>
                    <span className={styles.msgTime}>{relTime(3)}</span>
                  </div>
                  <div className={styles.bubble}>
                    <p className={styles.msgText}>
                      Confirmed one regression. Preview reports itemCount 0; main reports 1.
                    </p>
                    <div className={styles.compare}>
                      <span className={styles.compareCell}>
                        Preview · badge 1 ·{' '}
                        <span className={styles.compareBad}>itemCount 0</span>
                      </span>
                      <span className={styles.compareCell}>Main · badge 1 · itemCount 1</span>
                      <span className={styles.fact}>94% · reproduced 2/2</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {phase >= 4 && (
              <>
                <div className={`land ${styles.msg}`}>
                  <span className={`${styles.mark} ${styles.markDiagnosis}`}>DX</span>
                  <div className={styles.msgBody}>
                    <div className={styles.msgHead}>
                      <span className={styles.msgRole}>Diagnosis</span>
                      <span className={styles.msgFn}>Root cause</span>
                      <span className={styles.msgTime}>{relTime(4)}</span>
                    </div>
                    <div className={styles.bubble}>
                      <p className={styles.msgText}>
                        serializeCart.ts:42 reads the stale pre-navigation counter.
                      </p>
                    </div>
                  </div>
                </div>
                <div className={`land ${styles.msg}`}>
                  <span className={`${styles.mark} ${styles.markRepair}`}>RP</span>
                  <div className={styles.msgBody}>
                    <div className={styles.msgHead}>
                      <span className={styles.msgRole}>Repair</span>
                      <span className={styles.msgFn}>Patch generation</span>
                      <span className={styles.msgTime}>{relTime(4)}</span>
                    </div>
                    <div className={styles.bubble}>
                      <p className={styles.msgText}>Prepared the smallest patch.</p>
                      <pre className={styles.diff}>
                        <code>
                          <span className={styles.diffMinus}>- itemCount: cart.itemCount</span>
                          {'\n'}
                          <span className={styles.diffPlus}>+ itemCount: cart.items.length</span>
                        </code>
                      </pre>
                    </div>
                  </div>
                </div>
              </>
            )}

            {phase >= 5 && (
              <div className={`land ${styles.msg}`}>
                <span className={`${styles.mark} ${styles.markVerifier}`}>VR</span>
                <div className={styles.msgBody}>
                  <div className={styles.msgHead}>
                    <span className={styles.msgRole}>Verifier</span>
                    <span className={styles.msgFn}>Fix replay</span>
                    <span className={styles.msgTime}>{relTime(5)}</span>
                  </div>
                  <div className={`${styles.bubble} ${styles.bubbleGood}`}>
                    <p className={styles.msgText}>Replayed the same journey on the fix.</p>
                    <span className={styles.factGood}>itemCount 1 · 3/3 checks passed</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={threadEnd} />
          </div>
        </main>
      </div>
    </div>
  );
}
