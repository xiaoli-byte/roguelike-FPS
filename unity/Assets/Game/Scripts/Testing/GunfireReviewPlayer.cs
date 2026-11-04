using System;
using System.IO;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Game.Testing
{
    public sealed class GunfireReviewPlayer : MonoBehaviour
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void StartReview()
        {
            var args = Environment.GetCommandLineArgs();
            bool extra = args.Contains("--gunfire-review-extra", StringComparer.Ordinal);
            if (!extra && !args.Contains("--gunfire-review", StringComparer.Ordinal)) return;
            Application.runInBackground = true;
            var go = new GameObject("Gunfire Review Player");
            var runner = go.AddComponent<PlaytestRunner>();
            runner.suite = extra ? "gunfireextra" : "gunfireoriginal";
            string directory = Path.Combine(Environment.CurrentDirectory, "review");
            Directory.CreateDirectory(directory);
            runner.resultPath = Path.Combine(directory, extra ? "result-extra.txt" : "result.txt");
            runner.shotDir = directory;
            go.AddComponent<GunfireReviewPlayer>();
        }

        void Update()
        {
            if (PlaytestRunner.Done) Application.Quit();
        }
    }
}
