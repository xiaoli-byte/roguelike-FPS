"""Exercise cold asset arrival, actual selection UI, and render the hero gallery."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[2] / 'art/reviews/heroes-20261005'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1800, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5173/')
    page.locator('.gf-menu__nav button').first.click()
    # Open the stage while background GLBs are still arriving, then wait for the
    # same library used by production. The screen must refresh its fallback slot.
    assets = page.evaluate("""async () => {
        const {AssetLibrary} = await import('/src/assets/AssetLibrary.ts');
        await AssetLibrary.preload();
        return ['fox','bear','falcon'].map(id => AssetLibrary.findBound('hero', id)?.id);
    }""")
    assert all(assets), f'Missing published hero assets: {assets}'
    page.wait_for_timeout(2500)
    for hero in ['fox', 'bear', 'falcon', 'fox']:
        page.locator(f'#gf-hero-tab-{hero}').click()
        page.wait_for_timeout(2300)
        assert page.locator(f'#gf-hero-tab-{hero}').get_attribute('aria-selected') == 'true'
        assert page.locator('.gf-hero-stage canvas').is_visible()
        page.screenshot(path=str(OUT / f'{hero}-selection.png'))
    page.goto('http://127.0.0.1:5173/hero-gallery.html')
    page.wait_for_function('window.__heroGallery !== undefined')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(OUT / 'heroes-lineup.png'))
    assert page.locator('#review-mode').inner_text()=='查看正式材质', 'Gallery must default to clay review'
    idle=page.evaluate("() => window.__heroGallery.panels.map(({rig})=>rig.hand.getWorldPosition(rig.root.position.clone()).toArray())")
    page.locator('#review-pose').click()
    assert page.locator('#review-pose').get_attribute('aria-pressed')=='true'
    raised=page.evaluate("() => window.__heroGallery.panels.map(({rig})=>rig.hand.getWorldPosition(rig.root.position.clone()).toArray())")
    for i in [0,2]:
        assert sum((a-b)**2 for a,b in zip(idle[i],raised[i]))**.5>.08, 'Raise control must move the wrist'
    page.screenshot(path=str(OUT/'heroes-white-raised.png'))
    page.locator('#review-pose').click()
    assert page.locator('#review-pose').get_attribute('aria-pressed')=='false'
    lods = page.evaluate("""() => {
        const {panels, render} = window.__heroGallery;
        const records = [];
        for (const [level, z] of [4.8,12,26].entries()) {
            for (const panel of panels) {
                panel.camera.position.z = z;
            }
            render();
            for (const {rig} of panels) {
                let lod;
                rig.root.traverse(o => { if(o.isLOD && /SK_Hero_/.test(o.name)) lod=o; });
                if(!lod || lod.getCurrentLevel() !== level) throw new Error('Hero LOD did not switch');
                const mesh = lod.levels[level].object;
                mesh.skeleton.update();
                const positions = mesh.geometry.attributes.position;
                const v = rig.root.position.clone();
                for(let i=0;i<positions.count;i++) {
                    v.fromBufferAttribute(positions,i); mesh.applyBoneTransform(i,v);
                    if(![v.x,v.y,v.z].every(Number.isFinite)) throw new Error('Nonfinite LOD vertex');
                }
                records.push({name:mesh.name,level,vertices:positions.count});
            }
        }
        for (const panel of panels) { panel.camera.position.z=4.8; }
        render();
        return records;
    }""")
    assert not errors, errors
    (OUT / 'menu-browser.json').write_text(json.dumps({'loaded': assets, 'lods':lods, 'errors': errors}, indent=2), encoding='utf-8')
    print('PASS: cold load, all hero selections, return switch, nine actual LODs, actual-model gallery')
    browser.close()
