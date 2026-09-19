import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { gitIntent } from "./git-intent.js";
it("reads real commit intent and uses the merge base after the base branch advances", async () => {
 const dir = await mkdtemp(join(tmpdir(),"intent-fixture-"));
 const exec=promisify(execFile);
 const git=async(...args:string[])=>(await exec("git",["-c","commit.gpgsign=false","-c","user.name=Test","-c","user.email=test@example.test",...args],{cwd:dir})).stdout;
 await git("init","-b","main"); await writeFile(join(dir,"price.ts"),"export const price=84\n"); await git("add","."); await git("commit","-m","initial");
 await git("switch","-c","feature"); await writeFile(join(dir,"price.ts"),"export const price=NaN\n"); await git("commit","-am","feat: adjust price"); const sha=(await git("rev-parse","HEAD")).trim();
 await git("switch","main");await writeFile(join(dir,"unrelated.txt"),"not part of feature");await git("add",".");await git("commit","-m","unrelated main work");
 const intent=await gitIntent("o/r","main","feature",dir);
 expect(intent.headSha).toBe(sha);expect(intent.messages).toEqual(["feat: adjust price"]);expect(intent.files.map(f=>f.filename)).toEqual(["price.ts"]);expect(intent.files[0]?.patch).toContain("+export const price=NaN");expect(intent.files[0]?.additions).toBe(1);
});
