using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 配乐导演：有遭遇战场地的关卡里，按战况切曲（同 Three.js：交战时擂鼓、肃清后交叉淡入舒缓曲，搜刮时不再擂鼓）。
    ///   有场地在交战（Phase.Active）→ combat；Boss 在场 → boss；否则 calm。玩家阵亡时停（GameSession 已切到 none）。
    /// 每次载入场景自动挂上（R 重开也会），不用摆进场景。
    /// </summary>
    public sealed class MusicDirector : MonoBehaviour
    {
        float next;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            SceneManager.sceneLoaded -= OnLoaded;
            SceneManager.sceneLoaded += OnLoaded;
            Ensure();
        }

        static void OnLoaded(Scene s, LoadSceneMode m) => Ensure();

        static void Ensure()
        {
            if (FindAnyObjectByType<MusicDirector>() || !FindAnyObjectByType<EncounterSite>()) return;
            new GameObject("Music Director").AddComponent<MusicDirector>();
        }

        void Update()
        {
            if (Time.unscaledTime < next) return;
            next = Time.unscaledTime + 0.5f;
            var pv = PlayerVitals.Instance;
            if (pv && pv.Dead) return;
            string want = "calm";
            foreach (var s in FindObjectsByType<EncounterSite>())
                if (s.phase == EncounterSite.Phase.Active) { want = "combat"; break; }
            foreach (var e in EnemyAI.All)
                if (e && !e.Dead && e.enemyId != null && e.enemyId.StartsWith("boss")) { want = "boss"; break; }
            GameAudio.SetMusic(want);
        }
    }
}
