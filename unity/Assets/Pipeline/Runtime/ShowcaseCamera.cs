using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Art
{
    /// <summary>
    /// 展示场景相机：
    ///   右键按住 + 鼠标  转视角        WASD / QE  移动 / 升降       Shift  加速
    ///   F                第一人称 / 自由视角切换（第一人称时显示枪与手臂，相机固定在 1.6 米眼高）
    ///   1–9              跳到 Viewpoints 下的第 n 个机位        H  所有角色从镜头方向受击        K  全部倒下（布娃娃）/ 复活
    ///   G                画质 低 → 中 → 高 循环（<see cref="ArtQuality.Cycle"/>，对比毛发；会存进 PlayerPrefs，和游戏里暂停菜单的「画质」是同一项）
    /// </summary>
    public sealed class ShowcaseCamera : MonoBehaviour
    {
        public float moveSpeed = 6f;
        public float lookSpeed = 0.12f;
        public float eyeHeight = 1.6f;
        public GameObject firstPersonRig;
        public Transform viewpoints;
        public bool firstPerson;

        float yaw, pitch;
        float toastUntil;
        GUIStyle toastStyle;

        void Start()
        {
            var e = transform.eulerAngles;
            yaw = e.y;
            pitch = e.x > 180 ? e.x - 360 : e.x;
            ApplyMode();
        }

        void ApplyMode()
        {
            if (firstPersonRig) firstPersonRig.SetActive(firstPerson);
        }

        public void GoTo(int index)
        {
            if (!viewpoints || index < 0 || index >= viewpoints.childCount) return;
            var vp = viewpoints.GetChild(index);
            transform.SetPositionAndRotation(vp.position, vp.rotation);
            var e = vp.eulerAngles;
            yaw = e.y;
            pitch = e.x > 180 ? e.x - 360 : e.x;
        }

        void Update()
        {
            var kb = Keyboard.current;
            var mouse = Mouse.current;
            if (kb == null || mouse == null) return;

            if (kb.fKey.wasPressedThisFrame) { firstPerson = !firstPerson; ApplyMode(); }
            if (kb.hKey.wasPressedThisFrame)
                foreach (var a in FindObjectsByType<ShowcaseActor>(FindObjectsSortMode.None)) a.Hit(0.6f);
            if (kb.kKey.wasPressedThisFrame)
            {
                var all = FindObjectsByType<ShowcaseActor>(FindObjectsSortMode.None);
                bool anyAlive = System.Array.Exists(all, a => !a.IsDead);
                foreach (var a in all) { if (anyAlive) a.Kill(); else a.Respawn(); }
            }
            if (kb.gKey.wasPressedThisFrame)
            {
                var level = ArtQuality.Cycle();
                toastUntil = Time.unscaledTime + 1.6f;
                Debug.Log($"[showcase] 画质 → {ArtQuality.Label(level)}");
            }
            for (int i = 0; i < 9; i++)
                if (kb[Key.Digit1 + i].wasPressedThisFrame) GoTo(i);

            if (mouse.rightButton.isPressed || firstPerson)
            {
                var d = mouse.delta.ReadValue();
                yaw += d.x * lookSpeed;
                pitch = Mathf.Clamp(pitch - d.y * lookSpeed, -85f, 85f);
            }
            transform.rotation = Quaternion.Euler(pitch, yaw, 0);

            var move = Vector3.zero;
            if (kb.wKey.isPressed) move += Vector3.forward;
            if (kb.sKey.isPressed) move += Vector3.back;
            if (kb.aKey.isPressed) move += Vector3.left;
            if (kb.dKey.isPressed) move += Vector3.right;
            float speed = moveSpeed * (kb.leftShiftKey.isPressed ? 3f : 1f) * Time.deltaTime;
            if (firstPerson)
            {
                // 第一人称只在水平面移动，眼高固定
                var flat = Quaternion.Euler(0, yaw, 0);
                var p = transform.position + flat * move * speed;
                p.y = eyeHeight;
                transform.position = p;
            }
            else
            {
                if (kb.eKey.isPressed) move += Vector3.up;
                if (kb.qKey.isPressed) move += Vector3.down;
                transform.position += transform.rotation * move * speed;
            }
        }

        // 按 G 后左上角短暂显示当前画质（样板场景没有 HUD）
        void OnGUI()
        {
            if (Time.unscaledTime > toastUntil) return;
            toastStyle ??= new GUIStyle
            {
                font = Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "Arial" }, 28),
                fontSize = 28,
                normal = { textColor = new Color(1f, 0.9f, 0.7f) },
            };
            GUI.Label(new Rect(24, 20, 400, 40), $"画质：{ArtQuality.Label(ArtQuality.Level)}", toastStyle);
        }
    }
}
