using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡场景里的玩家出生标记（docs/unity-parity.md 4.6）：<see cref="SceneFlow"/> 进关时由 <see cref="PlayerFactory"/> 在这里组装玩家，
    /// 位置 = 脚底（地面上方一点点），朝向只取水平（Y 轴）。一个关卡场景放一个；有多个时取第一个（以后检查点 / 中途续玩再按 id 区分）。
    /// 由关卡构建器（Level_x_y）摆放，不手摆。
    /// </summary>
    public sealed class PlayerSpawn : MonoBehaviour
    {
        /// <summary>出生朝向（水平）</summary>
        public Quaternion Facing
        {
            get
            {
                var f = transform.forward;
                f.y = 0;
                return f.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(f.normalized) : Quaternion.identity;
            }
        }

        /// <summary>场景里的出生标记；没有则 null</summary>
        public static PlayerSpawn In(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            foreach (var root in scene.GetRootGameObjects())
            {
                var s = root.GetComponentInChildren<PlayerSpawn>(true);
                if (s) return s;
            }
            return null;
        }

        /// <summary>
        /// 场景里的出生位姿：PlayerSpawn → 旧版关卡的「Site_Spawn」标记（朝向取物体朝向）→ 原点上方 2 m（打警告）
        /// </summary>
        public static (Vector3 position, Quaternion rotation) Resolve(Scene scene)
        {
            var spawn = In(scene);
            if (spawn) return (spawn.transform.position, spawn.Facing);
            if (scene.IsValid() && scene.isLoaded)
                foreach (var root in scene.GetRootGameObjects())
                    foreach (var t in root.GetComponentsInChildren<Transform>(true))
                        if (t.name == "Site_Spawn" || t.name == "PlayerSpawn")
                        {
                            var f = t.forward;
                            f.y = 0;
                            return (t.position + Vector3.up * 0.05f, f.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(f.normalized) : Quaternion.identity);
                        }
            Debug.LogWarning($"[SceneFlow] 关卡 {scene.path} 里没有 PlayerSpawn，玩家放在原点上方");
            return (Vector3.up * 2f, Quaternion.identity);
        }

        void OnDrawGizmos()
        {
            var p = transform.position;
            Gizmos.color = new Color(1f, 0.55f, 0.2f, 0.9f);
            Gizmos.DrawWireCube(p + Vector3.up * 0.9f, new Vector3(0.7f, 1.8f, 0.7f));
            var f = Facing * Vector3.forward;
            Gizmos.DrawLine(p + Vector3.up * 1.62f, p + Vector3.up * 1.62f + f * 1.5f);
        }
    }
}
