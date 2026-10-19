using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 远景与氛围：远处看得见的地标效果（烽燧狼烟的烟柱…）。归 L4。
    public static partial class LevelKit
    {
        // ───────────── 烟柱（烽燧狼烟）─────────────
        public static ParticleSystem Smoke(string dir, Transform parent, Vector3 pos, Color color)
        {
            string texPath = $"{dir}/T_SoftPuff.png";
            if (!File.Exists(texPath))
            {
                const int n = 64;
                var tex = new Texture2D(n, n, TextureFormat.RGBA32, false);
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                    float a = Landform.Smooth(1f, 0.35f, d);
                    tex.SetPixel(x, y, new Color(1, 1, 1, a));
                }
                File.WriteAllBytes(texPath, tex.EncodeToPNG());
                Object.DestroyImmediate(tex);
                AssetDatabase.ImportAsset(texPath);
                var ti = (TextureImporter)AssetImporter.GetAtPath(texPath);
                ti.alphaIsTransparency = true;
                ti.wrapMode = TextureWrapMode.Clamp;
                ti.SaveAndReimport();
            }
            var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = "M_Smoke" };
            m.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(texPath));
            m.SetColor("_BaseColor", color);
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 0);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)RenderQueue.Transparent;
            SaveAsset(m, $"{dir}/M_Smoke.mat");

            var go = new GameObject("Beacon Smoke");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(pos, Quaternion.Euler(-90, 0, 0));
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.duration = 10;
            main.loop = true;
            main.prewarm = true;
            main.startLifetime = 11;
            main.startSpeed = 2.4f;
            main.startSize = new ParticleSystem.MinMaxCurve(2.5f, 4f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0, Mathf.PI * 2);
            main.maxParticles = 200;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = ps.emission;
            em.rateOverTime = 7;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 6;
            shape.radius = 0.8f;
            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            // 高空风把烟柱往西南吹弯（与沙丘、雅丹同一主风向）
            vel.x = new ParticleSystem.MinMaxCurve(0, AnimationCurve.Linear(0, 0, 1, -1.6f));
            vel.y = new ParticleSystem.MinMaxCurve(0, AnimationCurve.Linear(0, 0, 1, 0));
            vel.z = new ParticleSystem.MinMaxCurve(0, AnimationCurve.Linear(0, 0, 1, -1.1f));
            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1, AnimationCurve.EaseInOut(0, 0.6f, 1, 3.2f));
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(0.6f, 0), new GradientAlphaKey(1, 0.05f), new GradientAlphaKey(0.7f, 0.6f), new GradientAlphaKey(0, 1) });
            col.color = g;
            var rot = ps.rotationOverLifetime;
            rot.enabled = true;
            rot.z = new ParticleSystem.MinMaxCurve(-0.3f, 0.3f);
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.sortMode = ParticleSystemSortMode.Distance;
            return ps;
        }
    }
}
