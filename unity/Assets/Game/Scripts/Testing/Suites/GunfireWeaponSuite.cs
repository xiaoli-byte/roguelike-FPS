using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    public sealed class GunfireWeaponSuite : PlaytestSuite
    {
        public override string Id => "gunfire";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        int errors;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            var systems = SystemsBootstrap.Find();
            if (!arena || !systems)
            {
                Fail("缺少 TestArena 刷怪台或 Game Systems");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            Application.logMessageReceived += OnLog;
            PlayerRig rig = null;
            try
            {
                var baked = FindAnyObjectByType<PlayerVitals>();
                var pos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
                var rot = arena.playerSpawn ? arena.playerSpawn.rotation : Quaternion.identity;
                if (baked)
                {
                    baked.gameObject.SetActive(false);
                    Destroy(baked.gameObject);
                }
                yield return null;
                var hero = HeroLibrary.Get(HeroLibrary.DefaultHero);
                rig = PlayerFactory.Create(hero, pos, rot);
                PlayerFactory.Bind(systems, rig);
                SystemsBootstrap.Setup();
                yield return null;
                yield return null;

                var def = WeaponLibrary.Get("rifle");
                var inst = new WeaponInstance(def);
                rig.weapons.Give(inst);
                yield return new WaitForSeconds(0.7f);
                var view = rig.weapons.rigs.FirstOrDefault(r => r.weaponId == "rifle")?.view;
                if (!view)
                {
                    Fail("Gunfire 步枪没有第一人称 rig");
                    yield break;
                }
                Shot(rig.cam, "gunfire_rifle_hip");
                var gun = WeaponRigParts.GunOf(view.transform, def.prefab);
                var sockets = WeaponSockets.Of(gun);
                int found = sockets ? WeaponSockets.SocketNames.Count(n => sockets.Socket(n)) : 0;
                var native = gun ? gun.GetComponent<GunfireOriginalAnimation>() : null;
                Line(native
                    ? $"原生枪模 {def.prefab}；双手 Animator {native.GetComponentsInChildren<Animator>(true).Length}；枪口 {(found > 0 ? "已接" : "没接")}"
                    : $"枪模 {def.prefab}；挂点 {found}/6；机械瞄具 {WeaponSight.For("rifle").kind}");
                if (native ? !native || found < 1 : found != 6) Fail("枪械运行挂点不全");

                rig.weapons.testAim = true;
                yield return new WaitForSeconds(0.55f);
                Shot(rig.cam, "gunfire_rifle_iron_sight");
                rig.weapons.testAim = false;
                yield return new WaitForSeconds(0.25f);

                inst.mag = 28;
                rig.weapons.testReload = true;
                yield return null;
                float start = Time.time;
                while (!rig.weapons.Reloading && Time.time - start < 1f) yield return null;
                bool captured = false;
                while (rig.weapons.Reloading && Time.time - start < 6)
                {
                    if (!captured && rig.weapons.ReloadProgress >= 0.5f)
                    {
                        captured = true;
                        Shot(rig.cam, "gunfire_rifle_reload");
                    }
                    yield return null;
                }
                yield return new WaitForSeconds(0.25f);
                Line($"换弹完成：{inst.mag}/{def.mag}，动画截图 {captured}");
                if (inst.mag != def.mag || !captured) Fail("换弹或换弹截图未完成");

                int ammoBeforeFire = inst.mag;
                rig.weapons.testFire = true;
                yield return new WaitForSeconds(0.18f);
                rig.weapons.testFire = false;
                Shot(rig.cam, "gunfire_rifle_fire");
                Line($"开火后弹匣 {inst.mag}（射击前 {ammoBeforeFire}）；运行错误 {errors}");
                if (inst.mag >= ammoBeforeFire) Fail("开火没有消耗弹药");
                if (errors > 0) Fail($"运行时报错 {errors} 条");
            }
            finally
            {
                if (rig != null && rig.weapons)
                {
                    rig.weapons.testFire = false;
                    rig.weapons.testAim = false;
                    rig.weapons.testReload = false;
                }
                Application.logMessageReceived -= OnLog;
            }
        }

        void OnLog(string message, string stack, LogType type)
        {
            if (type is LogType.Error or LogType.Exception) errors++;
        }
    }
}
