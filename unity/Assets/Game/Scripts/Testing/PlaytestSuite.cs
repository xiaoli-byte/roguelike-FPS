using System.Collections;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 冒烟测试套件的基类：<see cref="Steps"/> 里写测试步骤（协程），Line / Fail / Shot 转给宿主 <see cref="PlaytestRunner"/>，
    /// 另带几样通用操控（瞬移玩家、瞄准、找最近的敌人、找能看到目标的站位、在玩家前方刷怪、敌人侧面近景截图）。
    /// 套件跑完（或中途 yield break）后由宿主统一收尾：写首行结论、关掉 TestMode、通知编辑器退出 Play。
    /// </summary>
    public abstract class PlaytestSuite : IPlaytestSuite
    {
        public abstract string Id { get; }
        public abstract string Scene { get; }

        /// <summary>宿主：结果文件、截图目录、战斗计数（hits / damage / killsById …）都在它身上</summary>
        protected PlaytestRunner Runner { get; private set; }
        protected string ResultPath => Runner.resultPath;
        protected string ShotDir => Runner.shotDir;

        public IEnumerator Run(PlaytestRunner runner)
        {
            Runner = runner;
            return Steps();
        }

        /// <summary>测试步骤：Play 模式里当协程跑</summary>
        protected abstract IEnumerator Steps();

        protected void Line(string s) => Runner.Line(s);
        protected void Fail(string s) => Runner.Fail(s);
        protected void Shot(Camera cam, string name) => Runner.Shot(cam, name);

        // ───────────── 通用操控 ─────────────
        protected EnemyAI SpawnAhead(PlayerMotor motor, string id, float distance, float hpMult, float sideOffset = 0)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var e = EnemyRoster.Spawn(id, motor.transform.position + fwd * distance + side * sideOffset, Quaternion.LookRotation(-fwd), 1, false);
            if (!e) { Fail($"生成 {id} 失败"); return null; }
            e.Health.maxHealth *= hpMult;
            e.Health.ResetVitals();
            return e;
        }

        /// <summary>目标周围 8–12 m、NavMesh 上、眼高能直接看到瞄准点的位置</summary>
        protected static bool SightSpot(Damageable target, Vector3 aim, out Vector3 spot)
        {
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = target.transform.position + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(8f, 12f);
                if (!UnityEngine.AI.NavMesh.SamplePosition(p, out var hit, 3f, UnityEngine.AI.NavMesh.AllAreas)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        protected static Damageable NearestEnemy(Vector3 from)
        {
            Damageable best = null;
            float bestD = float.MaxValue;
            foreach (var d in FindObjectsByType<Damageable>())
            {
                if (d.Dead || d.untargetable) continue;
                float dist = Vector3.Distance(from, d.transform.position);
                if (dist < bestD) { bestD = dist; best = d; }
            }
            return best;
        }

        protected static void Teleport(PlayerMotor motor, Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            cc.enabled = false;
            motor.transform.position = p;
            cc.enabled = true;
        }

        protected static Vector3 BodyCenter(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        protected static void Aim(PlayerMotor motor, Transform eye, Vector3 at)
        {
            var dir = at - eye.position;
            float yaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            float pitch = -Mathf.Atan2(dir.y, new Vector2(dir.x, dir.z).magnitude) * Mathf.Rad2Deg;
            motor.SetLook(yaw, pitch);
        }

        /// <summary>敌人侧面 3.5 m 的近景（临时相机，不带 HUD），看身体姿态</summary>
        protected void PoseShot(EnemyAI ai, Vector3 side, string name)
        {
            var col = ai.GetComponent<Collider>();
            var c = col ? col.bounds.center : ai.transform.position + Vector3.up;
            float size = col ? Mathf.Max(1.2f, col.bounds.size.y) : 1.8f;
            var go = new GameObject("Pose Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 50;
            cam.nearClipPlane = 0.05f;
            go.transform.position = c + side * (2f + size) + Vector3.up * 0.3f;
            go.transform.LookAt(c);
            Shot(cam, name);
            Destroy(go);
        }
    }
}
