"""Inspect the complete weapon/body relationship, including close grip views."""
from pathlib import Path
import argparse
import json
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[2] / 'art/reviews/heroes-20261005'
parser=argparse.ArgumentParser()
parser.add_argument('--rest',action='store_true')
parser.add_argument('--capture-only',action='store_true')
args=parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1500,'height':1000})
    records=[]
    for hero in ['fox','falcon']:
        page.goto(f'http://127.0.0.1:5173/hero-lab.html?hero={hero}&t=1&white')
        page.wait_for_function('window.__lab !== undefined')
        elapsed=1.0
        last_intro=0.0
        stages=[.65] if args.rest or args.capture_only else [0,.15,.3,.45,.65,.85,1.1,1.3]
        for pose, param in [('idle','')] + [(f'intro-{t}',f'&intro={t}') for t in stages]:
            if pose.startswith('intro-'):
                intro=float(pose.split('-',1)[1])
                page.evaluate("""([delta,start,first]) => {
                    const {rig,render}=window.__lab;
                    if(first) rig.playIntro();
                    const steps=Math.round(delta*60);
                    for(let i=1;i<=steps;i++) rig.update(1/60,start+i/60);
                    render();
                }""",[intro-last_intro,elapsed,intro==stages[0]])
                elapsed+=intro-last_intro
                last_intro=intro
            if not args.rest and not args.capture_only:
                record=page.evaluate("""async () => {
                    const {auditHeroGrip}=await import('/src/dev/heroGripAudit.ts');
                    const {rig}=window.__lab;
                    const fixed=auditHeroGrip(rig);
                    return {fixed};
                }""")
                records.append({'hero':hero,'pose':pose,**record})
                print(hero,pose,record['fixed'],flush=True)
                assert record['fixed']['intrusions']==0, f'{hero} {pose}: gun penetrates body'
                assert record['fixed']['gloveIntrusions']==0, f'{hero} {pose}: gun penetrates fingers'
                assert record['fixed']['gloveDistance']<.03, f'{hero} {pose}: grip misses authored glove'
                assert record['fixed']['wrapCoverage']>=5, f'{hero} {pose}: grip only touches fingertips'
                assert not record['fixed']['gripInsideGlove'], f'{hero} {pose}: grip centre is buried inside a finger'
                assert record['fixed']['wristError']<.00001, f'{hero} {pose}: hand detached from wrist'
            if pose not in ['idle','intro-0.65']:
                continue
            if args.rest and pose=='idle':
                page.evaluate("""async hero => {
                    const THREE=await import('/node_modules/.vite/deps/three.js');
                    const {AssetLibrary}=await import('/src/assets/AssetLibrary.ts');
                    const {rig,scene}=window.__lab;
                    rig.root.visible=false;
                    const src=AssetLibrary.findBound('hero',hero).lods[0];
                    scene.add(new THREE.Mesh(src.geometry,src.material));
                    rig.hand.getWorldPosition=out=>out.set(-.26,.7,.035);
                }""",hero)
            page.evaluate("""() => {
                const {rig,cams,render} = window.__lab;
                const grip=rig.hand.getWorldPosition(rig.root.position.clone());
                for(const [i,offset] of [[4,[-.6,.28,.75]],[5,[-.85,.2,-.25]]]) {
                    cams[i].position.copy(grip).add(rig.root.position.clone().set(...offset));
                    cams[i].lookAt(grip); cams[i].fov=32;
                }
                const labels=document.querySelectorAll('#labels div');
                labels[4].textContent='持枪近看 · 前侧'; labels[5].textContent='持枪近看 · 外侧';
                render();
            }""")
            name='intro' if pose=='intro-0.65' else pose
            page.screenshot(path=str(OUT / f'{hero}-{name}-grip{"-rest" if args.rest else ""}.png'))
    browser.close()
    if not args.rest and not args.capture_only:
        for hero in ['fox','falcon']:
            idle=next(r['fixed']['wrist'] for r in records if r['hero']==hero and r['pose']=='idle')
            raised=next(r['fixed']['wrist'] for r in records if r['hero']==hero and r['pose']=='intro-0.65')
            assert sum((a-b)**2 for a,b in zip(idle,raised))**.5>.08, f'{hero}: wrist did not raise with the weapon'
        (OUT/'grip-clearance.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
