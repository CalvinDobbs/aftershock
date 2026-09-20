import { expect, it, vi } from "vitest";
import { runRepairChain, type RepairServices } from "./repair-chain.js";
import { Finding, type RunEvent } from "@aftershock/schema";
import { AssignmentSchema, AssignmentResultSchema } from "@aftershock/schema/browser";
const assignment = AssignmentSchema.parse({ id:"A1",runId:"r",archetype:"conformance",route:"/cart",objective:"Total is correct",journey:[{instruction:"Read total",action:{method:"snapshot",selector:"",description:"Read total"}}] });
const before = AssignmentResultSchema.parse({assignmentId:"A1",sessionId:"old",steps:[],findings:[{class:"assertion_violation",severity:"high",signature:"total",summary:"NaN",stepIndex:0,evidence:[]}],startedAt:new Date(0).toISOString(),finishedAt:new Date(1).toISOString()});
const finding = () => Finding.parse({id:"f",runId:"r",assignmentIds:["A1"],class:"assertion_violation",status:"confirmed",severity:"high",title:"Cart total NaN",route:"/cart",signature:"total",expected:"Total is numeric",expectedSource:"PR",actual:"NaN",baseConfidence:.65,confidence:.8,modifiers:[],reproCount:2,reproAttempts:2,repro:["Read total"],filed:false});
const intent = {repo:"o/r",baseSha:"base",headSha:"head",messages:["refactor total"],files:[{filename:"lib/money.ts",status:"modified",additions:1,deletions:1,patch:"@@ -1 +1 @@\n-export const total=1\n+export const total=NaN"}]};
function setup(passes=true) {
 const events:RunEvent[]=[];
 const services:RepairServices={
  github:{createIssue:vi.fn(async()=>({number:1,html_url:"https://github.com/o/r/issues/1"})),createBranch:vi.fn(async()=>"head"),commitFiles:vi.fn(async()=>"fix"),openPullRequest:vi.fn(async()=>({number:2,html_url:"https://github.com/o/r/pull/2"})),setCommitStatus:vi.fn(async()=>{})},
  model:{complete:async()=>({hypotheses:[{file:"lib/money.ts",lines:[1],confidence:.9,explanation:"NaN introduced",evidence:["diff"]}],recommendedApproach:"Restore numeric value",inconclusive:false})},
  codex:{session:()=>({run:async()=>({threadId:"thread",changedFiles:["lib/money.ts"],finalResponse:JSON.stringify({summary:"fix: restore total",rationale:"Restore numeric total",usedHypothesis:"lib/money.ts"})})})},
  readDiff:async()=>"diff --git a/lib/money.ts b/lib/money.ts\n--- a/lib/money.ts\n+++ b/lib/money.ts\n@@ -1 +1 @@\n-export const total=NaN\n+export const total=1",
  readFiles:async()=>[{path:"lib/money.ts",content:"export const total=1"}],prepareCheckout:async()=>"/isolated/checkout",previewForPatch:async()=>"https://fix.test",
 };
 const input={runId:"r",intent,baseBranch:"feat/coupons",baseUrl:"https://base.test",findings:[finding()],drafts:[{runId:"r",findingId:"f",title:"Cart total NaN",body:"Wrong total",labels:[],fixChecklist:["Total is numeric"]}],failed:[{assignment,before}],regressionSuite:[assignment],emit:async(e:RunEvent)=>{events.push(e)},services,browser:{runAssignment:async()=>({...before,sessionId:"new",findings:passes?[]:before.findings}),runDifferential:async()=>({assignmentId:"D1",previewSessionId:"new",baseSessionId:"base",deltas:[],noiseFiltered:0,findings:[],completed:true,startedAt:before.startedAt,finishedAt:before.finishedAt})}};
 return {input,events,services};
}
it("runs real diagnosis, patch, verify and publish exports in order",async()=>{const {input,events,services}=setup();const result=await runRepairChain(input);expect(result.verification?.passed).toBe(true);expect(result.pullRequest?.draft).toBe(false);expect(events.map(e=>e.type)).toEqual(["issue.filed","stage.start","sleuth.complete","stage.start","understudy.complete","stage.start","curtaincall.complete","understudy.complete","pr.opened"]);expect(services.github.openPullRequest).toHaveBeenCalledWith(expect.objectContaining({base:"feat/coupons",draft:false}));expect(input.findings[0]?.filed).toBe(true);});
it("retries once and publishes an explicitly unverified draft",async()=>{const {input,events}=setup(false);const result=await runRepairChain(input);expect(result.patch?.attempt).toBe(2);expect(result.verification?.passed).toBe(false);expect(result.pullRequest?.draft).toBe(true);expect(events.filter(e=>e.type==="curtaincall.complete")).toHaveLength(2);});
it("cannot claim verified without the baseline",async()=>{const {input}=setup();const result=await runRepairChain({...input,baseUrl:null});expect(result.verification?.passed).toBe(false);expect(result.pullRequest?.draft).toBe(true);});
it("does not file or patch without configured services",async()=>{const {input,services,events}=setup();const {services:_,...unconfigured}=input;const result=await runRepairChain(unconfigured);expect(result.issues).toEqual([]);expect(services.github.createIssue).not.toHaveBeenCalled();expect(events.every(e=>e.type==="stage.skip")).toBe(true);});

it("verifies a local repair without publishing when review is required",async()=>{
 const {input,services,events}=setup();
 services.publishRepairs=false;
 const result=await runRepairChain(input);
 expect(result.patch?.diff).toContain("export const total=1");
 expect(result.verification?.passed).toBe(true);
 expect(result.pullRequest).toBeNull();
 for (const fn of [services.github.createBranch,services.github.commitFiles,services.github.openPullRequest,services.github.setCommitStatus]) expect(fn).not.toHaveBeenCalled();
 expect(events.some(e=>e.type==="curtaincall.complete")).toBe(true);
});
