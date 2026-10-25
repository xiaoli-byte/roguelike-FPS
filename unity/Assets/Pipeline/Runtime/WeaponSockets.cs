using System;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称武器 Prefab 上的语义零件与挂点（W3，由 ArtPrefabBuilder 按 &lt;ID&gt;.art.json 的 weapon 段生成，不要手改 Prefab）。
    /// 零件 = 导出时改过名的骨骼（muzzle / mag / cylinder / spinner / pump / bolt / barrels / sightGroup / lamp），活动零件动画转它们；
    /// 挂点 = 挂在零件下的空节点，跟着零件走（坐标约定：枪模空间，枪管朝 −Z，单位米；Prefab 根就是枪模根）：
    ///   muzzle   枪口（骨骼本身；方向用 <see cref="Forward"/>，不读骨骼朝向）
    ///   sight    开镜视线穿过的瞄准点
    ///   leftGrip 左手握点（霰弹枪挂在泵动护木上、赤蛟霰铳挂在枪管组上）
    ///   load     换弹时左手送弹的位置（整匣换弹挂在弹匣 / 转轮 / 能量罐下，跟着它离位）
    ///   finish   换弹收尾的操作点（拉机柄、推泵、合枪管）
    ///   eject    抛壳 / 排气口，+Z 指向抛出方向
    /// 没有这个组件（旧 Prefab、测试里的假 rig）时，调用方按名字深度查找（<see cref="FindDeep"/>）兜底。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WeaponSockets : MonoBehaviour
    {
        public const string Muzzle = "muzzle", Sight = "sight", LeftGrip = "leftGrip", Load = "load", Finish = "finish", Eject = "eject";
        public static readonly string[] SocketNames = { Muzzle, Sight, LeftGrip, Load, Finish, Eject };

        /// <summary>武器 id（TS / WeaponDef 的 id）</summary>
        public string weaponId;
        public Transform muzzle, sight, leftGrip, load, finish, eject;
        /// <summary>语义零件：名字与骨骼一一对应（mag 与 cylinder 同一根骨骼时两条都在）</summary>
        public string[] partNames = Array.Empty<string>();
        public Transform[] parts = Array.Empty<Transform>();

        /// <summary>挂点（名字见 <see cref="SocketNames"/>）；没有为 null</summary>
        public Transform Socket(string name) => name switch
        {
            Muzzle => muzzle,
            Sight => sight,
            LeftGrip => leftGrip,
            Load => load,
            Finish => finish,
            Eject => eject,
            _ => null,
        };

        /// <summary>零件（骨骼）；没有为 null</summary>
        public Transform Part(string name)
        {
            for (int i = 0; i < partNames.Length && i < parts.Length; i++)
                if (partNames[i] == name) return parts[i];
            return null;
        }

        /// <summary>枪管方向（世界空间）：枪模根的 −Z（赤蛟霰铳折开时跟着枪管组）</summary>
        public Vector3 Forward
        {
            get
            {
                var barrels = Part("barrels");
                return -(barrels ? barrels : transform).forward;
            }
        }

        /// <summary>gun 下的挂点组件（gun 自己或子孙）；没有为 null</summary>
        public static WeaponSockets Of(Transform gun) => gun ? gun.GetComponentInChildren<WeaponSockets>(true) : null;

        /// <summary>挂点或零件：先读组件，再按名字深度查找（旧 Prefab / 假 rig）；fallbacks 依次尝试</summary>
        public static Transform Find(Transform gun, string name, params string[] fallbacks)
        {
            if (!gun) return null;
            var s = Of(gun);
            if (s)
            {
                var t = s.Socket(name);
                if (!t) t = s.Part(name);
                if (t) return t;
            }
            var found = FindDeep(gun, name);
            if (found) return found;
            foreach (var f in fallbacks)
            {
                found = s ? s.Part(f) : null;
                if (!found) found = FindDeep(gun, f);
                if (found) return found;
            }
            return null;
        }

        public static Transform FindDeep(Transform root, string name)
        {
            if (!root || string.IsNullOrEmpty(name)) return null;
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                var t = FindDeep(root.GetChild(i), name);
                if (t) return t;
            }
            return null;
        }
    }
}
