"""Capture actual hero display poses and export their gameplay rigs from local Vite."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art/reviews/heroes-20261005"
HEROES = {"fox": "SK_Hero_Fox", "bear": "SK_Hero_Bear", "falcon": "SK_Hero_Falcon"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", action="store_true")
    parser.add_argument("--before", action="store_true")
    parser.add_argument("--heroes", nargs="+", choices=list(HEROES), default=list(HEROES))
    parser.add_argument("--candidate", type=int, help="unpublished build version, for one selected hero")
    parser.add_argument("--verify", action="store_true", help="check live rig, deformation and grip tolerances")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 1000}, device_scale_factor=1)
        logs = []
        page.on("pageerror", lambda error: logs.append(str(error)))
        if args.export:
            page.goto("http://127.0.0.1:5173/hero-lab.html?classic&nogun=1")
            page.wait_for_function("window.__lab !== undefined")
            for hero in args.heroes:
                asset = HEROES[hero]
                meta = page.evaluate("""async ([hero, asset]) => {
                    const art = await import('/src/dev/artExport.ts');
                    return await art.exportHeroParts(hero, asset);
                }""", [hero, asset])
                (OUT / f"{hero}-rig.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
                print(f"EXPORTED {hero}: {len(meta['joints'])} joints", flush=True)
        else:
            suffix = "before" if args.before else "after"
            records = []
            for hero in args.heroes:
                classic = "&classic" if args.before else ""
                page.goto(f"http://127.0.0.1:5173/hero-lab.html?hero={hero}&t=1{classic}")
                page.wait_for_function("window.__lab !== undefined")
                elapsed,last_intro=1.0,0.0
                for pose, extra in (("idle", ""), ("intro-start", "&intro=0.2"),
                                    ("intro", "&intro=0.65"), ("intro-end", "&intro=1.3")):
                    if args.candidate and pose == 'idle':
                        page.evaluate("""async ([hero,version]) => {
                            const {replaceHeroCandidate}=await import('/src/dev/heroCandidate.ts');
                            await replaceHeroCandidate(hero,version);
                        }""", [hero,args.candidate])
                    if extra:
                        intro=float(extra.split('=')[1])
                        page.evaluate("""([delta,start,first])=>{
                            const {rig,render}=window.__lab;
                            if(first)rig.playIntro();
                            for(let i=1;i<=Math.round(delta*60);i++)rig.update(1/60,start+i/60);
                            render();
                        }""",[intro-last_intro,elapsed,pose=='intro-start'])
                        elapsed+=intro-last_intro
                        last_intro=intro
                    page.screenshot(path=str(OUT / f"{hero}-{pose}-{suffix}.png"))
                    state = page.evaluate("""() => {
                        const {rig} = window.__lab;
                        const meshes = [];
                        rig.root.traverse(o => { if(o.isMesh && /SK_Hero_.*_LOD/.test(o.name))
                            meshes.push({name:o.name, skinned:!!o.isSkinnedMesh, visible:o.visible,
                              vertices:o.geometry.attributes.position.count}); });
                        const body = [];
                        rig.root.updateWorldMatrix(true, true);
                        rig.root.traverse(mesh => {
                            if (!mesh.isSkinnedMesh || !/_LOD0$/.test(mesh.name)) return;
                            mesh.skeleton.update();
                            const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
                            const original = rig.root.position.clone(), posed = rig.root.position.clone();
                            const points = new Float32Array(positions.count * 3), bind = new Float32Array(positions.count * 3);
                            let invalid = 0, gripDistance = Infinity;
                            const grip = rig.root.position.clone().set(0, 0, 0);
                            if (rig.hand.name === 'hero-art-grip') grip.set(0, mesh.name.includes('Fox') ? -.055 : -.058, mesh.name.includes('Fox') ? .035 : .032);
                            rig.hand.localToWorld(grip);
                            rig.hand.traverse(o=>{
                                if(!o.isMesh||!o.userData.heroGripHand)return;
                                const p=o.geometry.attributes.position;
                                for(let i=0;i<p.count;i++) {
                                    posed.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
                                    gripDistance=Math.min(gripDistance,posed.distanceTo(grip));
                                }
                            });
                            for (let i = 0; i < positions.count; i++) {
                                original.fromBufferAttribute(positions, i).toArray(bind, i * 3);
                                posed.copy(original); mesh.applyBoneTransform(i, posed);
                                posed.toArray(points, i * 3);
                                if (![posed.x,posed.y,posed.z].every(Number.isFinite)) invalid++;
                                gripDistance = Math.min(gripDistance, posed.applyMatrix4(mesh.matrixWorld).distanceTo(grip));
                            }
                            const stretch = [];
                            let stretched = 0;
                            const distance = (p,a,b) => Math.hypot(p[a*3]-p[b*3],p[a*3+1]-p[b*3+1],p[a*3+2]-p[b*3+2]);
                            for(let i=0;i<index.count;i+=3) {
                                const t=[index.getX(i),index.getX(i+1),index.getX(i+2)];
                                for(let j=0;j<3;j++) {
                                    const a=t[j], b=t[(j+1)%3], d=distance(bind,a,b);
                                    if(d<0.0005) continue;
                                    const r=distance(points,a,b)/d;
                                    stretch.push(r); if(r>2) stretched++;
                                }
                            }
                            stretch.sort((a,b)=>a-b);
                            body.push({name:mesh.name, bones:mesh.skeleton.bones.length, invalid,
                                gripDistance, p99Stretch:stretch[Math.floor(stretch.length*.99)],
                                stretchedRatio:stretched/stretch.length});
                        });
                        return {meshes, body, height:rig.height};
                    }""")
                    records.append({"hero": hero, "pose": pose, **state})
                    if args.verify and not args.before:
                        assert len(state["meshes"]) == 3, f"{hero}: authored LODs did not bind"
                        assert len(state["body"]) == 1, f"{hero}: expected one authored body"
                        audit = state["body"][0]
                        assert audit["invalid"] == 0, f"{hero} {pose}: invalid posed vertices"
                        assert audit["gripDistance"] < 0.04, f"{hero} {pose}: weapon misses palm"
                        assert audit["p99Stretch"] < 1.8, f"{hero} {pose}: excessive deformation"
                        assert audit["stretchedRatio"] < 0.01, f"{hero} {pose}: too many stretched edges"
                    print(f"CAPTURED {hero} {pose}: {state}", flush=True)
            (OUT / f"browser-{suffix}.json").write_text(json.dumps({"records": records, "errors": logs}, indent=2), encoding="utf-8")
            if args.verify:
                assert not logs, f"Browser errors: {logs}"
        browser.close()

if __name__ == "__main__":
    main()
