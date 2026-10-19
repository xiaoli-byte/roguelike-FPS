using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人占位体（docs/unity-parity.md 4.11「代码不等美术」）：场景里没有敌人 Prefab 时，<see cref="EnemyRoster"/> 用它代替美术。
    ///   根节点：按 <see cref="EnemyDef"/> 设计尺寸（radius / height）的角色胶囊碰撞体，生成时同样乘 scale；
    ///   身体：主题色胶囊；弱点：挂在名为 weakBone 的空节点上（离地 weakHeight），元素色发光球 + 光晕，EnemyBody 在这里挂弱点判定球。
    /// 没有 Animator / CreatureRig / 布娃娃：EnemyAI 基类对这些都判空，AI 照常走位、出招（动作和挂点依赖美术的子类 AI 可能缺表现）。
    /// 这个组件本身只是标记，验收报告和测试用它数出场景里的占位敌人。
    /// </summary>
    public sealed class PlaceholderBody : MonoBehaviour
    {
        public string enemyId;

        /// <summary>弱点节点名：定义里写了骨骼名就用它（AI 按名字找骨骼时也能找到），否则用固定名</summary>
        public static string WeakBoneName(EnemyDef def) => string.IsNullOrEmpty(def.weakBone) ? "placeholder_weak" : def.weakBone;

        /// <summary>按定义搭一个停用状态的占位敌人（EnemyRoster 挂完组件再激活）</summary>
        public static GameObject Create(EnemyDef def, Vector3 position, Quaternion rotation, Transform parent)
        {
            var go = new GameObject($"{def.name} ({def.id})");
            go.SetActive(false);
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(position, rotation);
            go.transform.localScale = Vector3.one * def.scale;
            go.AddComponent<PlaceholderBody>().enemyId = def.id;

            float r = Mathf.Max(0.1f, def.radius), h = Mathf.Max(def.height, r * 2f);
            var cap = go.AddComponent<CapsuleCollider>();
            cap.radius = r;
            cap.height = h;
            cap.center = new Vector3(0, h * 0.5f, 0);

            var bodyColor = Color.Lerp(def.color, new Color(0.18f, 0.16f, 0.15f), 0.35f);
            var body = Primitive(PrimitiveType.Capsule, "Body", go.transform, new Vector3(0, h * 0.5f, 0), new Vector3(r * 2f, h * 0.5f, r * 2f));
            Tint(body, bodyColor, false);
            // 朝向标记：正前方一块小楔子，看得出它面朝哪边
            var nose = Primitive(PrimitiveType.Cube, "Facing", go.transform, new Vector3(0, h * 0.75f, r * 0.95f), new Vector3(r * 0.5f, r * 0.25f, r * 0.4f));
            Tint(nose, def.GlowColor, true);

            var weak = new GameObject(WeakBoneName(def)).transform;
            weak.SetParent(go.transform, false);
            weak.localPosition = new Vector3(0, Mathf.Clamp(def.WeakHeight, 0, h), r * 0.6f);
            var glow = def.GlowColor;
            var orb = Primitive(PrimitiveType.Sphere, "WeakGlow", weak, Vector3.zero, Vector3.one * Mathf.Max(0.08f, def.weakRadius) * 2f);
            Tint(orb, glow * 1.6f, true);
            FxMaterials.GlowSprite(weak, Mathf.Max(0.5f, def.weakRadius * 6f), new Color(glow.r, glow.g, glow.b, 0.75f));
            return go;
        }

        static Renderer Primitive(PrimitiveType type, string name, Transform parent, Vector3 pos, Vector3 scale)
        {
            var p = GameObject.CreatePrimitive(type);
            p.name = name;
            var c = p.GetComponent<Collider>();
            if (Application.isPlaying) Destroy(c);
            else DestroyImmediate(c);
            p.transform.SetParent(parent, false);
            p.transform.localPosition = pos;
            p.transform.localScale = scale;
            return p.GetComponent<Renderer>();
        }

        /// <summary>发光件用不受光的纯色材质（看起来就是自发光），身体用默认受光材质 + 主题色</summary>
        static void Tint(Renderer r, Color c, bool glow)
        {
            if (glow)
            {
                r.sharedMaterial = FxMaterials.Unlit;
                FxMaterials.Tint(r, c);
                return;
            }
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", c);
            r.SetPropertyBlock(block);
            r.shadowCastingMode = ShadowCastingMode.On;
        }
    }
}
