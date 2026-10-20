using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡交互件的程序化占位体块（灵火坛、藏宝点、自带的出口石门）：默认材质 + 属性块改色，和宝箱同一种做法。
    /// 关卡给了美术模型（物体下有名为 Model 的子物体）时这些件不生成，换正式资产不改代码（4.11 占位策略）。
    /// </summary>
    static class PropBits
    {
        static MaterialPropertyBlock block;

        public static Renderer Box(Transform parent, string name, Vector3 pos, Vector3 size, Color c, bool collider = false) =>
            Make(PrimitiveType.Cube, parent, name, pos, size, c, collider);

        /// <summary>圆柱（size.y 是全高；Unity 圆柱原始高 2 m）</summary>
        public static Renderer Cylinder(Transform parent, string name, Vector3 pos, Vector3 size, Color c, bool collider = false) =>
            Make(PrimitiveType.Cylinder, parent, name, pos, new Vector3(size.x, size.y * 0.5f, size.z), c, collider);

        static Renderer Make(PrimitiveType type, Transform parent, string name, Vector3 pos, Vector3 scale, Color c, bool collider)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            if (!collider) Object.Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = scale;
            var r = go.GetComponent<Renderer>();
            r.shadowCastingMode = ShadowCastingMode.On;
            Tint(r, c);
            return r;
        }

        public static void Tint(Renderer r, Color c)
        {
            if (!r) return;
            block ??= new MaterialPropertyBlock();
            r.GetPropertyBlock(block);
            block.SetColor("_BaseColor", c);
            r.SetPropertyBlock(block);
        }

        /// <summary>物体下已有美术模型（名为 Model 的子物体）</summary>
        public static bool HasModel(Transform t) => t && t.Find("Model");

        /// <summary>地面高度（世界层自上而下射线；打不到返回 p.y）</summary>
        public static float GroundY(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 4, Vector3.down, out var h, 20, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;
    }
}
