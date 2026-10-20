using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 主菜单场景的镜头（U5 / U6）：两个机位——远景（<see cref="Pose.Home"/>：城门、篝火、远处巨像，祭台在画面中间）和祭台特写
    /// （<see cref="Pose.Heroes"/>：选英雄；机位由祭台 HeroStage 按自己的位置算好挂在它下面）。
    /// 换机位用缓入缓出插值（位置、朝向、视野一起），远景机位上镜头缓慢漂移、随鼠标轻微偏转（Three.js 主菜单的视差在这里是真 3D 的）。
    /// 全部用不缩放时间。机位缺失时退回自己当前的位置。
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public sealed class MenuCamera : MonoBehaviour
    {
        public enum Pose
        {
            Home,
            Heroes,
        }

        public static MenuCamera Instance { get; private set; }

        [Tooltip("远景机位")] public Transform homeAnchor;
        [Tooltip("祭台特写机位（HeroStage 运行时补上）")] public Transform heroesAnchor;
        public float homeFov = 46f, heroesFov = 30f;
        [Tooltip("换机位的时长（秒）")] public float blendTime = 1.1f;
        [Tooltip("远景机位随鼠标偏转的幅度（度）")] public float parallax = 1.6f;
        [Tooltip("远景机位缓慢漂移的幅度（米）")] public float drift = 0.3f;

        Camera cam;
        Pose pose = Pose.Home;
        Vector3 fromPos;
        Quaternion fromRot;
        float fromFov, blendStart = -100f;
        Vector2 look;

        /// <summary>当前机位</summary>
        public Pose Current => pose;
        /// <summary>换机位已经到位</summary>
        public bool Settled => Time.unscaledTime - blendStart >= blendTime;
        public Camera Camera => cam;

        void Awake()
        {
            Instance = this;
            cam = GetComponent<Camera>();
            if (!homeAnchor)
            {
                homeAnchor = new GameObject("Camera Home").transform;
                homeAnchor.SetPositionAndRotation(transform.position, transform.rotation);
            }
            fromPos = transform.position;
            fromRot = transform.rotation;
            fromFov = cam.fieldOfView;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>换机位（instant = 直接切过去）</summary>
        public void Go(Pose p, bool instant = false)
        {
            if (p == pose && !instant) return;
            fromPos = transform.position;
            fromRot = transform.rotation;
            fromFov = cam ? cam.fieldOfView : homeFov;
            pose = p;
            blendStart = instant ? -100f : Time.unscaledTime;
        }

        Transform Anchor(Pose p) => p == Pose.Heroes && heroesAnchor ? heroesAnchor : homeAnchor;

        void LateUpdate()
        {
            var a = Anchor(pose);
            if (!a || !cam) return;
            float now = Time.unscaledTime, dt = Mathf.Min(Time.unscaledDeltaTime, 0.1f);
            var p = GameInput.PointerPosition;
            var target = Screen.width > 0 && Screen.height > 0
                ? new Vector2(Mathf.Clamp(p.x / Screen.width * 2 - 1, -1, 1), Mathf.Clamp(p.y / Screen.height * 2 - 1, -1, 1))
                : Vector2.zero;
            look = Vector2.Lerp(look, target, 1 - Mathf.Exp(-3f * dt));

            var pos = a.position;
            var rot = a.rotation;
            float fov = pose == Pose.Heroes ? heroesFov : homeFov;
            if (pose == Pose.Home)
            {
                pos += a.right * (Mathf.Sin(now * 0.13f) * drift) + a.up * (Mathf.Sin(now * 0.21f) * drift * 0.4f);
                rot *= Quaternion.Euler(-look.y * parallax * 0.6f, look.x * parallax, 0);
            }
            else rot *= Quaternion.Euler(-look.y * 0.35f, look.x * 0.5f, 0);

            float k = blendTime > 0 ? Mathf.Clamp01((now - blendStart) / blendTime) : 1;
            k = k * k * (3 - 2 * k);
            transform.SetPositionAndRotation(Vector3.Lerp(fromPos, pos, k), Quaternion.Slerp(fromRot, rot, k));
            cam.fieldOfView = Mathf.Lerp(fromFov, fov, k);
        }
    }
}
