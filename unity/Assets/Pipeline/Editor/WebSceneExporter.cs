using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Spiritfire.Art.Editor
{
    public static class WebSceneExporter
    {
        const string Output = "../public/assets/unity-levels.next";
        static readonly Dictionary<string, string> Meshes = new();
        static readonly Dictionary<string, string> Textures = new();
        static readonly JObject SceneDocs = new();

        public static void Batch()
        {
            ExportAll();
        }

        public static void ExportAll()
        {
            if (Directory.Exists(Output)) Directory.Delete(Output, true);
            Directory.CreateDirectory(Output);
            Directory.CreateDirectory(Output + "/scenes");
            Directory.CreateDirectory(Output + "/meshes");
            Directory.CreateDirectory(Output + "/textures");
            Meshes.Clear();
            Textures.Clear();
            SceneDocs.RemoveAll();
            var index = new JArray();
            var stages = new JArray();
            // 主线关卡 + 图池备选图（1-A / 2-A / 3-A）。备选图只进清单和场景目录（pool = true），
            // 不进 UnityStages.ts 的主线表：网页的每局路线自己决定什么时候抽它们
            foreach (var stage in RunPlan.Stages.Concat(RunPlan.Pool))
            {
                bool exists = File.Exists(stage.scene);
                string id = stage.code;
                var item = new JObject
                {
                    ["id"] = id,
                    ["title"] = stage.title,
                    ["chapter"] = stage.chapter,
                    ["index"] = stage.index,
                    ["kind"] = stage.kind == StageKind.Boss ? "boss" : "combat",
                    ["reward"] = stage.kind == StageKind.Boss ? "weapon" : "scroll",
                    ["scene"] = stage.scene,
                    ["available"] = exists,
                };
                if (stage.alt) item["pool"] = true;
                if (exists)
                {
                    item["url"] = $"assets/unity-levels/scenes/{id}.json";
                    ExportScene(stage, id);
                }
                index.Add(item);
                if (stage.alt) continue;
                stages.Add(new JObject
                {
                    ["chapter"] = stage.chapter - 1,
                    ["index"] = stage.index,
                    ["type"] = stage.kind == StageKind.Boss ? "boss" : "combat",
                    ["reward"] = stage.kind == StageKind.Boss ? "weapon" : "scroll",
                    ["title"] = stage.title,
                    ["available"] = exists,
                });
            }
            File.WriteAllText(Output + "/manifest.json", new JObject
            {
                ["schema"] = 1,
                ["source"] = "Unity scenes",
                ["stages"] = index,
            }.ToString(Formatting.Indented));
            string ts = "import type { StageNode } from '../core/types';\n\n" +
                "export interface UnityStage extends Omit<StageNode, 'theme'> { title: string; available: boolean }\n" +
                "export const UNITY_STAGES: readonly UnityStage[] = " + stages.ToString(Formatting.Indented) + ";\n" +
                "export const UNITY_FINAL_STAGE = UNITY_STAGES.filter(stage => stage.available).at(-1) ?? UNITY_STAGES[0];\n";
            File.WriteAllText("../src/world/UnityStages.ts", ts);
            string sceneData = "import type { UnitySceneDocument } from './UnityLevelLibrary';\n\n" +
                "export const UNITY_SCENE_DATA: Record<string, UnitySceneDocument> = {};\n";
            File.WriteAllText("../src/world/UnitySceneData.ts", sceneData);
            // 发布（压缩进 public/assets/unity-levels）改由 npm run unity:web:publish 做，不再整份拷贝原样导出
            Debug.Log($"[WebExport] {index.Count(s => (bool)s["available"])} scenes, {Meshes.Count} mesh variants, {Textures.Count} textures");
        }

        /// <summary>旧的整份拷贝发布（2 GB 原样进发布目录）已停用：发布走 scripts/unity/optimize-web-levels.mjs。</summary>
        public static void Publish()
        {
            throw new InvalidOperationException("webpublish 已停用：在仓库根目录跑 npm run unity:web:publish（scripts/unity/optimize-web-levels.mjs）");
        }

        static void ExportScene(StageSpec stage, string id)
        {
            var scene = EditorSceneManager.OpenScene(stage.scene, OpenSceneMode.Single);
            var spawn = PlayerSpawn.Resolve(scene);
            // 顶层出生点 = 保存状态里的出生点（主走法）；之后把各走法引用的物体临时激活，停用的出生点 / 出口 / 场地也导出来（场景不保存）
            ActivateLayoutObjects(scene);
            var doc = new JObject
            {
                ["schema"] = 1,
                ["id"] = id,
                ["title"] = stage.title,
                ["scene"] = stage.scene,
                ["spawn"] = new JObject
                {
                    ["position"] = Point(spawn.position),
                    ["forward"] = Direction(spawn.rotation * Vector3.forward),
                },
                ["renderers"] = new JArray(),
                ["colliders"] = new JArray(),
                ["heightfields"] = new JArray(),
                ["navigation"] = Navigation(scene),
                ["environment"] = Environment(scene),
                ["encounters"] = new JArray(),
                ["exits"] = new JArray(),
                ["caches"] = new JArray(),
                ["camps"] = new JArray(),
                ["bosses"] = new JArray(),
            };
            var bounds = new Bounds(spawn.position, Vector3.one * 4);
            foreach (var renderer in UnityEngine.Object.FindObjectsByType<MeshRenderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!renderer.enabled || renderer.gameObject.scene != scene || !VisibleLod(renderer)) continue;
                var filter = renderer.GetComponent<MeshFilter>();
                if (!filter || !filter.sharedMesh) continue;
                var materials = renderer.sharedMaterials.Where(m => m).ToArray();
                string url = ExportMesh(filter.sharedMesh, materials);
                var item = new JObject
                {
                    ["name"] = renderer.name,
                    ["scenePath"] = ScenePath(renderer.transform),
                    ["url"] = url,
                    ["position"] = Point(renderer.transform.position),
                    ["rotation"] = Rotation(renderer.transform.rotation),
                    ["scale"] = Scale(renderer.transform.lossyScale),
                };
                var platform = renderer.GetComponentInParent<MovingPlatform>();
                if (platform) item["platform"] = (platform.deck ? platform.deck : platform.transform).gameObject.GetEntityId().ToString();
                var water = renderer.GetComponentInParent<WaterVolume>();
                if (water) item["water"] = water.gameObject.GetEntityId().ToString();
                var activator = renderer.GetComponentInParent<SceneActivator>();
                if (activator)
                {
                    item["activator"] = activator.gameObject.GetEntityId().ToString();
                    if (activator.swing == renderer.transform) item["swing"] = true;
                    if (activator.lamps.Contains(renderer)) item["lamp"] = true;
                }
                ((JArray)doc["renderers"]).Add(item);
                bounds.Encapsulate(renderer.bounds);
            }
            foreach (var terrain in UnityEngine.Object.FindObjectsByType<Terrain>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!terrain.enabled || terrain.gameObject.scene != scene) continue;
                ExportTerrain(terrain, doc);
                bounds.Encapsulate(terrain.terrainData.bounds);
            }
            foreach (var collider in UnityEngine.Object.FindObjectsByType<Collider>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!collider.enabled || collider.isTrigger || collider.gameObject.scene != scene || collider is TerrainCollider) continue;
                var data = ExportCollider(collider);
                if (data == null) continue;
                data["scenePath"] = ScenePath(collider.transform);
                ((JArray)doc["colliders"]).Add(data);
            }
            foreach (var site in UnityEngine.Object.FindObjectsByType<EncounterSite>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (site.gameObject.scene != scene) continue;
                var encounter = Encounter(site);
                encounter["scenePath"] = ScenePath(site.transform);
                ((JArray)doc["encounters"]).Add(encounter);
            }
            foreach (var exit in UnityEngine.Object.FindObjectsByType<ExitPortal>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (exit.gameObject.scene != scene) continue;
                ((JArray)doc["exits"]).Add(new JObject
                {
                    ["position"] = Point(exit.transform.position),
                    ["rotation"] = Rotation(exit.transform.rotation),
                    ["reward"] = exit.clearReward,
                    ["requires"] = new JArray(exit.requires.Where(s => s).Select(s => s.title)),
                    ["scenePath"] = ScenePath(exit.transform),
                });
            }
            foreach (var cache in UnityEngine.Object.FindObjectsByType<CachePOI>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (cache.gameObject.scene != scene) continue;
                ((JArray)doc["caches"]).Add(new JObject
                {
                    ["title"] = cache.title,
                    ["position"] = Point(cache.transform.position),
                    ["reward"] = cache.reward,
                    ["discoverRadius"] = cache.discoverRadius,
                    ["guard"] = cache.guard ? cache.guard.title : null,
                    ["scenePath"] = ScenePath(cache.transform),
                });
            }
            foreach (var camp in UnityEngine.Object.FindObjectsByType<SupplyCamp>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (camp.gameObject.scene != scene) continue;
                ((JArray)doc["camps"]).Add(new JObject
                {
                    ["title"] = camp.label,
                    ["position"] = Point(camp.transform.position),
                    ["yaw"] = -camp.transform.eulerAngles.y * Mathf.Deg2Rad,
                    ["safeRadius"] = camp.safeRadius,
                    ["openShop"] = camp.openShop,
                    ["scenePath"] = ScenePath(camp.transform),
                });
            }
            // 怪物入场点（MonsterEntry）：据点之外的游荡怪群只从这些地方进场（网页 CombatDirector）
            var entries = new JArray();
            foreach (var entry in UnityEngine.Object.FindObjectsByType<MonsterEntry>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (entry.gameObject.scene != scene) continue;
                entries.Add(new JObject
                {
                    ["scenePath"] = ScenePath(entry.transform),
                    ["position"] = Point(entry.transform.position),
                    ["forward"] = Direction(entry.Facing),
                    ["mode"] = (int)entry.mode,
                    ["spread"] = entry.spread,
                    ["label"] = entry.label,
                    ["from"] = entry.from ? Point(entry.from.position) : JValue.CreateNull(),
                    ["flyersOnly"] = entry.flyersOnly,
                });
            }
            doc["entries"] = entries;
            doc["layout"] = Layout(scene);
            foreach (var boss in UnityEngine.Object.FindObjectsByType<BossEncounter>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (boss.gameObject.scene != scene) continue;
                ((JArray)doc["bosses"]).Add(new JObject
                {
                    ["id"] = boss.bossId,
                    ["position"] = Point(boss.arena ? boss.arena.BossSpawnPoint : boss.transform.position),
                    ["center"] = Point(boss.arena ? boss.arena.Center : boss.transform.position),
                    ["floorY"] = boss.arena ? boss.arena.FloorY : boss.transform.position.y,
                    ["radius"] = boss.arena ? boss.arena.radius : 30f,
                    ["reward"] = Point(boss.rewardPoint ? boss.rewardPoint.position : boss.transform.position),
                    ["stronghold"] = boss.stronghold,
                });
            }
            ExportDynamics(scene, doc);
            var meta = UnityEngine.Object.FindObjectsByType<LevelMeta>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)
                .FirstOrDefault(m => m.gameObject.scene == scene && m.mapArea.width > 0 && m.mapArea.height > 0);
            var playableMin = meta ? new Vector3(-meta.mapArea.xMax, spawn.position.y - 20f, meta.mapArea.yMin) : spawn.position - new Vector3(160f, 20f, 160f);
            var playableMax = meta ? new Vector3(-meta.mapArea.xMin, spawn.position.y + 80f, meta.mapArea.yMax) : spawn.position + new Vector3(160f, 80f, 160f);
            if (meta && meta.map)
            {
                string mapUrl = ExportTexture(meta.map).Replace("../textures/", "assets/unity-levels/textures/");
                doc["map"] = new JObject
                {
                    ["url"] = mapUrl,
                    ["area"] = new JArray(-meta.mapArea.xMax, -meta.mapArea.xMin, meta.mapArea.yMin, meta.mapArea.yMax),
                };
            }
            doc["bounds"] = new JObject { ["min"] = Scale(playableMin), ["max"] = Scale(playableMax) };
            doc["visualBounds"] = new JObject { ["min"] = new JArray(-bounds.max.x, bounds.min.y, bounds.min.z), ["max"] = new JArray(-bounds.min.x, bounds.max.y, bounds.max.z) };
            SceneDocs[id] = doc;
            File.WriteAllText($"{Output}/scenes/{id}.json", doc.ToString(Formatting.Indented));
        }

        static void ExportDynamics(Scene scene, JObject doc)
        {
            var platforms = new JArray();
            foreach (var platform in UnityEngine.Object.FindObjectsByType<MovingPlatform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!platform.enabled || platform.gameObject.scene != scene) continue;
                var deck = platform.deck ? platform.deck : platform.transform;
                var path = platform.path == null || platform.path.Length == 0 ? new[] { deck.position } : platform.path;
                int at = (deck.position - path[^1]).sqrMagnitude < (deck.position - path[0]).sqrMagnitude ? path.Length - 1 : 0;
                platforms.Add(new JObject
                {
                    ["id"] = deck.gameObject.GetEntityId().ToString(),
                    ["name"] = deck.name,
                    ["scenePath"] = ScenePath(deck),
                    ["path"] = new JArray(path.Select(Point)),
                    ["at"] = at,
                    ["size"] = new JArray(platform.deckSize.x, platform.deckThickness, platform.deckSize.y),
                    ["mode"] = (int)platform.mode,
                    ["onSignal"] = (int)platform.onSignal,
                    ["speed"] = platform.speed,
                    ["accel"] = platform.accel,
                    ["cornerSpeed"] = platform.cornerSpeed,
                    ["dwell"] = platform.dwell,
                    ["departDelay"] = platform.departDelay,
                    ["callDelay"] = platform.callDelay,
                    ["callRadius"] = platform.callRadius,
                    ["startPowered"] = platform.startPowered,
                    ["powerSite"] = platform.powerSite ? platform.powerSite.title : null,
                });
            }
            var waters = new JArray();
            foreach (var water in UnityEngine.Object.FindObjectsByType<WaterVolume>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!water.enabled || water.gameObject.scene != scene) continue;
                var spring = water.GetComponentInParent<HanbaSpring>();
                waters.Add(new JObject
                {
                    ["id"] = water.gameObject.GetEntityId().ToString(),
                    ["name"] = water.name,
                    ["scenePath"] = ScenePath(water.transform),
                    ["center"] = Point(water.transform.position),
                    ["scale"] = Scale(water.transform.lossyScale),
                    ["rotation"] = Rotation(water.transform.rotation),
                    ["shallow"] = water.shallow,
                    ["deep"] = water.deep,
                    ["wadeSlow"] = water.wadeSlow,
                    ["deepIsHazard"] = water.deepIsHazard,
                    ["drownBurst"] = water.drownBurst,
                    ["spring"] = spring != null,
                    ["beds"] = spring ? new JArray(spring.Beds.Select(Point)) : new JArray(),
                });
            }
            doc["platforms"] = platforms;
            doc["water"] = waters;
            var activators = new JArray();
            foreach (var activator in UnityEngine.Object.FindObjectsByType<SceneActivator>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!activator.enabled || activator.gameObject.scene != scene) continue;
                activators.Add(new JObject
                {
                    ["id"] = activator.gameObject.GetEntityId().ToString(),
                    ["scenePath"] = ScenePath(activator.transform),
                    ["position"] = Point(activator.transform.position),
                    ["byShot"] = activator.byShot,
                    ["byInteract"] = activator.byInteract,
                    ["minShotDamage"] = activator.minShotDamage,
                    ["toggle"] = activator.toggle,
                    ["oneShot"] = activator.oneShot,
                    ["cooldown"] = activator.cooldown,
                    ["lockedBy"] = activator.lockedBy ? activator.lockedBy.title : null,
                    ["lockedHint"] = activator.lockedHint,
                    ["title"] = activator.title,
                    ["verb"] = activator.verb,
                    ["hint"] = activator.hint,
                    ["toast"] = activator.toast,
                    ["focusHeight"] = activator.focusHeight,
                    ["interactRadius"] = activator.interactRadius,
                    ["onColor"] = Rgba(activator.onColor),
                    ["offColor"] = Rgba(activator.offColor),
                    ["targets"] = new JArray(activator.targets.Where(target => target).Select(target => target.gameObject.GetEntityId().ToString())),
                });
            }
            doc["activators"] = activators;
        }

        static JObject ExportCollider(Collider collider)
        {
            var data = new JObject
            {
                ["kind"] = collider is BoxCollider ? "box" : collider is SphereCollider ? "sphere" : collider is CapsuleCollider ? "capsule" : collider is MeshCollider ? "mesh" : "bounds",
                ["min"] = new JArray(-collider.bounds.max.x, collider.bounds.min.y, collider.bounds.min.z),
                ["max"] = new JArray(-collider.bounds.min.x, collider.bounds.max.y, collider.bounds.max.z),
                ["name"] = collider.name,
            };
            var platform = collider.GetComponentInParent<MovingPlatform>();
            if (platform) data["platform"] = (platform.deck ? platform.deck : platform.transform).gameObject.GetEntityId().ToString();
            var activator = collider.GetComponentInParent<SceneActivator>();
            if (activator) data["activator"] = activator.gameObject.GetEntityId().ToString();
            if (collider is BoxCollider box)
            {
                data["center"] = Point(box.transform.TransformPoint(box.center));
                data["size"] = new JArray(Mathf.Abs(box.size.x * box.transform.lossyScale.x), Mathf.Abs(box.size.y * box.transform.lossyScale.y), Mathf.Abs(box.size.z * box.transform.lossyScale.z));
                data["rotation"] = Rotation(box.transform.rotation);
                return data;
            }
            Mesh source = null;
            Matrix4x4 transform = default;
            if (collider is MeshCollider meshCollider)
            {
                source = meshCollider.sharedMesh;
                transform = meshCollider.transform.localToWorldMatrix;
            }
            else if (collider is SphereCollider sphere)
            {
                var primitive = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                source = primitive.GetComponent<MeshFilter>().sharedMesh;
                float diameter = sphere.radius * 2f * Mathf.Max(Mathf.Abs(sphere.transform.lossyScale.x), Mathf.Abs(sphere.transform.lossyScale.y), Mathf.Abs(sphere.transform.lossyScale.z));
                transform = Matrix4x4.TRS(sphere.transform.TransformPoint(sphere.center), sphere.transform.rotation, Vector3.one * diameter);
                UnityEngine.Object.DestroyImmediate(primitive);
            }
            else if (collider is CapsuleCollider capsule)
            {
                var primitive = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                source = primitive.GetComponent<MeshFilter>().sharedMesh;
                var lossy = capsule.transform.lossyScale;
                float diameter = capsule.radius * 2f * Mathf.Max(Mathf.Abs(lossy.x), Mathf.Abs(lossy.z));
                float height = capsule.height * Mathf.Abs(lossy.y);
                var axis = capsule.direction == 0 ? Vector3.right : capsule.direction == 2 ? Vector3.forward : Vector3.up;
                var rotation = capsule.transform.rotation * Quaternion.FromToRotation(Vector3.up, axis);
                transform = Matrix4x4.TRS(capsule.transform.TransformPoint(capsule.center), rotation, new Vector3(diameter, height * 0.5f, diameter));
                UnityEngine.Object.DestroyImmediate(primitive);
            }
            if (!source) return (string)data["kind"] == "bounds" ? data : null;
            var reflection = Matrix4x4.Scale(new Vector3(-1, 1, 1));
            var converted = reflection * transform;
            var mesh = UnityEngine.Object.Instantiate(source);
            mesh.name = collider.name + "_Collision";
            var vertices = mesh.vertices;
            for (int i = 0; i < vertices.Length; i++) vertices[i] = converted.MultiplyPoint3x4(vertices[i]);
            mesh.vertices = vertices;
            for (int submesh = 0; submesh < mesh.subMeshCount; submesh++)
            {
                var indices = mesh.GetTriangles(submesh);
                for (int i = 0; i < indices.Length; i += 3) (indices[i], indices[i + 2]) = (indices[i + 2], indices[i]);
                mesh.SetTriangles(indices, submesh);
            }
            mesh.RecalculateBounds();
            data["url"] = ExportMesh(mesh, Array.Empty<Material>());
            UnityEngine.Object.DestroyImmediate(mesh);
            return data;
        }

        static JObject Navigation(Scene scene)
        {
            var foreign = UnityEngine.Object.FindObjectsByType<Unity.AI.Navigation.NavMeshSurface>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)
                .Where(surface => surface.gameObject.scene == scene && surface.enabled && surface.agentTypeID != 0).ToArray();
            foreach (var surface in foreign) surface.enabled = false;
            try
            {
                var mesh = NavMesh.CalculateTriangulation();
                return new JObject
                {
                    ["vertices"] = new JArray(mesh.vertices.Select(Point)),
                    ["indices"] = new JArray(mesh.indices),
                    ["areas"] = new JArray(mesh.areas),
                };
            }
            finally
            {
                foreach (var surface in foreign) surface.enabled = true;
            }
        }

        static JObject Environment(Scene scene)
        {
            var sun = RenderSettings.sun ? RenderSettings.sun : UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)
                .FirstOrDefault(light => light.gameObject.scene == scene && light.enabled && light.type == LightType.Directional);
            var lights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)
                .Where(light => light.gameObject.scene == scene && light.enabled && light.type != LightType.Directional)
                .Select(light => new JObject
                {
                    ["type"] = (int)light.type,
                    ["position"] = Point(light.transform.position),
                    ["forward"] = Direction(light.transform.forward),
                    ["color"] = Rgba(light.color),
                    ["intensity"] = light.intensity,
                    ["range"] = light.range,
                    ["spotAngle"] = light.spotAngle,
                });
            JObject sky = null;
            if (RenderSettings.skybox)
            {
                var material = RenderSettings.skybox;
                var colors = new JObject();
                var floats = new JObject();
                var vectors = new JObject();
                for (int i = 0; i < material.shader.GetPropertyCount(); i++)
                {
                    string name = material.shader.GetPropertyName(i);
                    switch (material.shader.GetPropertyType(i))
                    {
                        case ShaderPropertyType.Color:
                            colors[name] = Rgba(material.GetColor(name));
                            break;
                        case ShaderPropertyType.Float:
                        case ShaderPropertyType.Range:
                            floats[name] = material.GetFloat(name);
                            break;
                        case ShaderPropertyType.Vector:
                            var vector = material.GetVector(name);
                            vectors[name] = new JArray(vector.x, vector.y, vector.z, vector.w);
                            break;
                    }
                }
                sky = new JObject
                {
                    ["name"] = material.name,
                    ["shader"] = material.shader.name,
                    ["colors"] = colors,
                    ["floats"] = floats,
                    ["vectors"] = vectors,
                };
                sky["cubemap"] = ExportSkybox(scene);
            }
            return new JObject
            {
                ["fog"] = new JObject
                {
                    ["enabled"] = RenderSettings.fog,
                    ["mode"] = (int)RenderSettings.fogMode,
                    ["color"] = Rgba(RenderSettings.fogColor),
                    ["start"] = RenderSettings.fogStartDistance,
                    ["end"] = RenderSettings.fogEndDistance,
                    ["density"] = RenderSettings.fogDensity,
                },
                ["ambient"] = new JObject
                {
                    ["mode"] = (int)RenderSettings.ambientMode,
                    ["sky"] = Rgba(RenderSettings.ambientSkyColor),
                    ["equator"] = Rgba(RenderSettings.ambientEquatorColor),
                    ["ground"] = Rgba(RenderSettings.ambientGroundColor),
                    ["light"] = Rgba(RenderSettings.ambientLight),
                    ["intensity"] = RenderSettings.ambientIntensity,
                },
                ["sun"] = sun ? new JObject
                {
                    ["forward"] = Direction(sun.transform.forward),
                    ["color"] = Rgba(sun.color),
                    ["intensity"] = sun.intensity,
                    ["shadows"] = (int)sun.shadows,
                    ["shadowStrength"] = sun.shadowStrength,
                } : null,
                ["sky"] = sky,
                ["lights"] = new JArray(lights),
            };
        }

        static JArray ExportSkybox(Scene scene)
        {
            var urls = new JArray();
            var go = new GameObject("WebSkyboxCapture") { hideFlags = HideFlags.HideAndDontSave };
            var camera = go.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.Skybox;
            camera.cullingMask = 0;
            camera.fieldOfView = 90;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 1000;
            var faces = new[]
            {
                (direction: new Vector3(1, 0, 0), up: Vector3.down, name: "px"),
                (direction: new Vector3(-1, 0, 0), up: Vector3.down, name: "nx"),
                (direction: new Vector3(0, 1, 0), up: Vector3.forward, name: "py"),
                (direction: new Vector3(0, -1, 0), up: Vector3.back, name: "ny"),
                (direction: new Vector3(0, 0, 1), up: Vector3.down, name: "pz"),
                (direction: new Vector3(0, 0, -1), up: Vector3.down, name: "nz"),
            };
            try
            {
                foreach (var face in faces)
                {
                    Vector3 Convert(Vector3 value) => new(-value.x, value.y, value.z);
                    camera.transform.rotation = Quaternion.LookRotation(Convert(face.direction), Convert(face.up));
                    var target = RenderTexture.GetTemporary(512, 512, 24, RenderTextureFormat.ARGB32);
                    var previous = RenderTexture.active;
                    camera.targetTexture = target;
                    camera.Render();
                    RenderTexture.active = target;
                    var copy = new Texture2D(512, 512, TextureFormat.RGBA32, false);
                    copy.ReadPixels(new Rect(0, 0, 512, 512), 0, 0);
                    copy.Apply();
                    RenderTexture.active = previous;
                    camera.targetTexture = null;
                    RenderTexture.ReleaseTemporary(target);
                    string name = $"sky_{scene.name}_{face.name}.png";
                    File.WriteAllBytes(Path.Combine(Output, "textures", name), copy.EncodeToPNG());
                    UnityEngine.Object.DestroyImmediate(copy);
                    urls.Add($"assets/unity-levels/textures/{name}");
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(go);
            }
            return urls;
        }

        static JArray Rgba(Color color) => new(color.r, color.g, color.b, color.a);

        static JObject Encounter(EncounterSite site)
        {
            var spec = site.squads;
            var waves = site.spec != null && !site.spec.IsEmpty ? site.spec.waves : new[] { new WaveSpec { entries = spec.Select(q => new WaveEntry { enemy = q.enemy, count = q.count, elite = q.elite, arrivalDelay = q.delay }).ToArray() } };
            return new JObject
            {
                ["title"] = site.title,
                ["position"] = Point(site.transform.position),
                ["triggerRadius"] = site.triggerRadius,
                ["entryDepth"] = site.entryDepth,
                ["requireSight"] = site.requireSight,
                ["autoTrigger"] = site.autoTrigger,
                ["arenaRadius"] = site.arenaRadius,
                ["requires"] = new JArray(site.requires.Where(s => s).Select(s => s.title)),
                ["anchors"] = new JArray(site.anchors.Where(a => a).Select(a => new JObject
                {
                    ["position"] = Point(a.position),
                    ["lane"] = a.GetComponent<SpawnAnchor>() ? a.GetComponent<SpawnAnchor>().lane : 0,
                    ["role"] = a.GetComponent<SpawnAnchor>() ? (int)a.GetComponent<SpawnAnchor>().role : 0,
                })),
                ["optional"] = site.optional,
                ["roadside"] = site.roadside,
                ["reward"] = site.reward,
                ["chestOffset"] = Point(site.chestOffset),
                ["difficulty"] = site.difficulty,
                ["waves"] = Waves(waves),
            };
        }

        static JArray Waves(System.Collections.Generic.IEnumerable<WaveSpec> waves)
        {
            return new JArray(waves.Where(w => w != null).Select(w => new JObject
                {
                    ["label"] = w.label,
                    ["hint"] = w.hint,
                    ["triggerRemaining"] = w.triggerRemaining,
                    ["delay"] = w.delay,
                    ["entries"] = new JArray(w.entries.Select(e => new JObject
                    {
                        ["enemy"] = e.enemy,
                        ["count"] = e.count,
                        ["elite"] = e.elite,
                        ["affix"] = e.affix,
                        ["role"] = (int)e.role,
                        ["arrivalDelay"] = e.arrivalDelay,
                        ["lane"] = e.lane,
                        ["holdBack"] = e.holdBack,
                        ["via"] = (int)e.via,
                    })),
                }));
        }

        /// <summary>
        /// 物体在场景里的层级路径（网页 LevelLayout 用它判断导出项属于哪个物体）：根物体名 / 子物体名 / …，
        /// 同一个父物体下有同名兄弟时，名字后加「#它在同名兄弟里的序号」
        /// </summary>
        static string ScenePath(Transform t)
        {
            var parts = new System.Collections.Generic.List<string>();
            for (var x = t; x; x = x.parent)
            {
                var siblings = x.parent
                    ? Enumerable.Range(0, x.parent.childCount).Select(i => x.parent.GetChild(i))
                    : x.gameObject.scene.GetRootGameObjects().Select(g => g.transform);
                var same = siblings.Where(o => o.name == x.name).ToList();
                parts.Add(same.Count > 1 ? $"{x.name}#{same.IndexOf(x)}" : x.name);
            }
            parts.Reverse();
            return string.Join("/", parts);
        }

        /// <summary>被任何走法引用的物体（出生点 / 出口 / only / hide）连同祖先临时激活：场景不保存，只为让停用的那套也导出来</summary>
        static void ActivateLayoutObjects(Scene scene)
        {
            var layout = LevelLayout.In(scene);
            if (!layout) return;
            foreach (var v in layout.variants)
            {
                if (v == null) continue;
                var objects = new System.Collections.Generic.List<GameObject>();
                if (v.spawn) objects.Add(v.spawn.gameObject);
                if (v.exit) objects.Add(v.exit.gameObject);
                objects.AddRange(v.only.Where(g => g));
                objects.AddRange(v.hide.Where(g => g));
                foreach (var go in objects)
                    for (var t = go.transform; t; t = t.parent)
                        if (!t.gameObject.activeSelf) t.gameObject.SetActive(true);
            }
        }

        /// <summary>图内布局变体（LevelLayout.variants），格式见 docs/threejs-migration.md 4.2；没有布局时 null</summary>
        static JToken Layout(Scene scene)
        {
            var layout = LevelLayout.In(scene);
            if (!layout || layout.variants == null || layout.variants.Length == 0) return JValue.CreateNull();
            return new JObject
            {
                ["variants"] = new JArray(layout.variants.Where(v => v != null).Select(v => new JObject
                {
                    ["id"] = v.id,
                    ["title"] = v.title,
                    ["weight"] = v.weight,
                    ["spawn"] = v.spawn ? new JObject
                    {
                        ["scenePath"] = ScenePath(v.spawn.transform),
                        ["position"] = Point(v.spawn.transform.position),
                        ["forward"] = Direction(v.spawn.transform.rotation * Vector3.forward),
                    } : JValue.CreateNull(),
                    ["exit"] = v.exit ? ScenePath(v.exit.transform) : null,
                    ["only"] = new JArray(v.only.Where(g => g).Select(g => ScenePath(g.transform))),
                    ["hide"] = new JArray(v.hide.Where(g => g).Select(g => ScenePath(g.transform))),
                    ["requires"] = new JArray(v.requires.Where(r => r != null && r.site).Select(r => new JObject
                    {
                        ["site"] = r.site.title,
                        ["requires"] = new JArray(r.requires.Where(x => x).Select(x => x.title)),
                    })),
                    ["sites"] = new JArray(v.sites.Where(o => o != null && o.site).Select(o => new JObject
                    {
                        ["site"] = o.site.title,
                        ["spec"] = o.replaceSpec && o.spec != null && !o.spec.IsEmpty ? new JObject { ["waves"] = Waves(o.spec.waves) } : JValue.CreateNull(),
                        ["reward"] = o.replaceReward ? o.reward : null,
                    })),
                })),
            };
        }

        static bool VisibleLod(MeshRenderer renderer)
        {
            var group = renderer.GetComponentInParent<LODGroup>();
            if (!group) return true;
            var lods = group.GetLODs();
            return lods.Length == 0 || lods[0].renderers.Contains(renderer);
        }

        static void ExportTerrain(Terrain terrain, JObject doc)
        {
            var data = terrain.terrainData;
            int resolution = data.heightmapResolution;
            var sourceHeights = data.GetHeights(0, 0, resolution, resolution);
            float Sample(int z, int x) => sourceHeights[z, x];
            var step = data.heightmapScale;
            var vertices = new Vector3[resolution * resolution];
            var uv = new Vector2[resolution * resolution];
            for (int z = 0; z < resolution; z++)
                for (int x = 0; x < resolution; x++)
                {
                    int i = z * resolution + x;
                    vertices[i] = new Vector3(x * step.x, Sample(z, x) * step.y, z * step.z);
                    uv[i] = new Vector2((float)x / (resolution - 1), (float)z / (resolution - 1));
                }
            var triangles = new int[(resolution - 1) * (resolution - 1) * 6];
            int cursor = 0;
            for (int z = 0; z < resolution - 1; z++)
                for (int x = 0; x < resolution - 1; x++)
                {
                    int i = z * resolution + x;
                    triangles[cursor++] = i;
                    triangles[cursor++] = i + resolution;
                    triangles[cursor++] = i + 1;
                    triangles[cursor++] = i + 1;
                    triangles[cursor++] = i + resolution;
                    triangles[cursor++] = i + resolution + 1;
                }
            var mesh = new Mesh { name = terrain.name + "_Heightfield", vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateNormals();
            var materials = data.terrainLayers.Length > 0 ? new[] { data.terrainLayers[0].diffuseTexture } : Array.Empty<Texture>();
            string url = ExportMesh(mesh, Array.Empty<Material>(), materials.FirstOrDefault());
            ((JArray)doc["renderers"]).Add(new JObject
            {
                ["name"] = terrain.name,
                ["url"] = url,
                ["position"] = Point(terrain.transform.position),
                ["rotation"] = Rotation(terrain.transform.rotation),
                ["scale"] = Scale(terrain.transform.lossyScale),
                ["terrain"] = TerrainSurface(data),
            });
            var packed = new float[resolution * resolution];
            for (int z = 0; z < resolution; z++)
                for (int x = resolution - 1; x >= 0; x--) packed[z * resolution + resolution - 1 - x] = Sample(z, x);
            var bytes = new byte[packed.Length * sizeof(float)];
            Buffer.BlockCopy(packed, 0, bytes, 0, bytes.Length);
            ((JArray)doc["heightfields"]).Add(new JObject
            {
                ["origin"] = new JArray(-terrain.transform.position.x - data.size.x, terrain.transform.position.y, terrain.transform.position.z),
                ["scale"] = Scale(step),
                ["resolution"] = resolution,
                ["heights"] = Convert.ToBase64String(bytes),
            });
            ExportTrees(terrain, doc);
            ExportDetails(terrain, doc);
            UnityEngine.Object.DestroyImmediate(mesh);
        }

        static JObject TerrainSurface(TerrainData data)
        {
            var alphamaps = new JArray();
            int width = data.alphamapWidth, height = data.alphamapHeight;
            var weights = data.GetAlphamaps(0, 0, width, height);
            for (int group = 0; group < (data.terrainLayers.Length + 3) / 4; group++)
            {
                var pixels = new Color[width * height];
                for (int y = 0; y < height; y++)
                    for (int x = 0; x < width; x++)
                    {
                        int layer = group * 4;
                        pixels[y * width + x] = new Color(
                            layer < data.terrainLayers.Length ? weights[y, x, layer] : 0,
                            layer + 1 < data.terrainLayers.Length ? weights[y, x, layer + 1] : 0,
                            layer + 2 < data.terrainLayers.Length ? weights[y, x, layer + 2] : 0,
                            layer + 3 < data.terrainLayers.Length ? weights[y, x, layer + 3] : 0);
                    }
                var texture = new Texture2D(width, height, TextureFormat.RGBA32, false) { name = $"Splat_{group}" };
                texture.SetPixels(pixels);
                texture.Apply();
                alphamaps.Add(ExportTexture(texture).Replace("../textures/", "assets/unity-levels/textures/"));
                UnityEngine.Object.DestroyImmediate(texture);
            }
            return new JObject
            {
                ["size"] = Scale(data.size),
                ["layers"] = new JArray(data.terrainLayers.Select(layer => new JObject
                {
                    ["url"] = ExportTexture(layer.diffuseTexture).Replace("../textures/", "assets/unity-levels/textures/"),
                    ["tileSize"] = new JArray(layer.tileSize.x, layer.tileSize.y),
                    ["tileOffset"] = new JArray(layer.tileOffset.x, layer.tileOffset.y),
                })),
                ["alphamaps"] = alphamaps,
            };
        }

        static void ExportTrees(Terrain terrain, JObject doc)
        {
            var data = terrain.terrainData;
            if (data.treeInstances.Length == 0) return;
            var vegetation = doc["vegetation"] as JObject;
            if (vegetation == null)
            {
                vegetation = new JObject { ["prototypes"] = new JArray(), ["instances"] = new JArray() };
                doc["vegetation"] = vegetation;
            }
            var prototypes = (JArray)vegetation["prototypes"];
            var instances = (JArray)vegetation["instances"];
            var byUrl = prototypes.Children<JObject>().ToDictionary(item => (string)item["url"], item => (int)item["index"]);
            foreach (var tree in data.treeInstances)
            {
                var prefab = data.treePrototypes[tree.prototypeIndex].prefab;
                var renderer = prefab.GetComponentsInChildren<MeshRenderer>(true).FirstOrDefault(VisibleLod);
                if (!renderer) continue;
                var filter = renderer.GetComponent<MeshFilter>();
                if (!filter || !filter.sharedMesh) continue;
                string url = ExportMesh(filter.sharedMesh, renderer.sharedMaterials.Where(material => material).ToArray());
                if (!byUrl.TryGetValue(url, out int index))
                {
                    index = prototypes.Count;
                    byUrl.Add(url, index);
                    prototypes.Add(new JObject { ["index"] = index, ["url"] = url, ["name"] = prefab.name });
                }
                instances.Add(new JObject
                {
                    ["prototype"] = index,
                    ["position"] = Point(terrain.transform.position + Vector3.Scale(tree.position, data.size)),
                    ["rotation"] = Rotation(Quaternion.Euler(0, tree.rotation * Mathf.Rad2Deg, 0)),
                    ["scale"] = new JArray(tree.widthScale, tree.heightScale, tree.widthScale),
                });
            }
            Debug.Log($"[WebExport] {doc["id"]} trees {instances.Count}");
        }

        static void ExportDetails(Terrain terrain, JObject doc)
        {
            var data = terrain.terrainData;
            if (data.detailPrototypes.Length == 0 || data.detailWidth == 0 || data.detailHeight == 0) return;
            var layers = doc["groundCover"] as JArray ?? new JArray();
            doc["groundCover"] = layers;
            for (int index = 0; index < data.detailPrototypes.Length; index++)
            {
                var prototype = data.detailPrototypes[index];
                var density = data.GetDetailLayer(new Vector2Int(0, 0), new Vector2Int(data.detailWidth, data.detailHeight), index);
                var counts = new int[data.detailWidth * data.detailHeight];
                int total = 0;
                for (int z = 0; z < data.detailHeight; z++)
                    for (int x = 0; x < data.detailWidth; x++)
                    {
                        int count = density[z, x];
                        counts[z * data.detailWidth + x] = count;
                        total += count;
                    }
                if (total == 0) continue;
                string url = null;
                if (prototype.usePrototypeMesh && prototype.prototype)
                {
                    var renderer = prototype.prototype.GetComponent<MeshRenderer>();
                    var filter = prototype.prototype.GetComponent<MeshFilter>();
                    if (renderer && filter && filter.sharedMesh)
                        url = ExportMesh(filter.sharedMesh, renderer.sharedMaterials.Where(material => material).ToArray());
                }
                string texture = prototype.prototypeTexture ? ExportTexture(prototype.prototypeTexture).Replace("../textures/", "assets/unity-levels/textures/") : null;
                if (string.IsNullOrEmpty(url) && string.IsNullOrEmpty(texture)) continue;
                var bytes = new byte[counts.Length * sizeof(int)];
                Buffer.BlockCopy(counts, 0, bytes, 0, bytes.Length);
                layers.Add(new JObject
                {
                    ["name"] = prototype.prototype ? prototype.prototype.name : prototype.prototypeTexture.name,
                    ["url"] = url,
                    ["texture"] = texture,
                    ["origin"] = Point(terrain.transform.position),
                    ["terrainSize"] = Scale(data.size),
                    ["width"] = data.detailWidth,
                    ["height"] = data.detailHeight,
                    ["counts"] = Convert.ToBase64String(bytes),
                    ["count"] = total,
                    ["minWidth"] = prototype.minWidth,
                    ["maxWidth"] = prototype.maxWidth,
                    ["minHeight"] = prototype.minHeight,
                    ["maxHeight"] = prototype.maxHeight,
                    ["noiseSeed"] = prototype.noiseSeed,
                    ["noiseSpread"] = prototype.noiseSpread,
                    ["positionJitter"] = prototype.positionJitter,
                    ["alignToGround"] = prototype.alignToGround,
                    ["holeEdgePadding"] = prototype.holeEdgePadding,
                    ["healthyColor"] = Rgba(prototype.healthyColor),
                    ["dryColor"] = Rgba(prototype.dryColor),
                    ["density"] = terrain.detailObjectDensity,
                    ["viewDistance"] = terrain.detailObjectDistance,
                });
            }
        }

        static string ExportMesh(Mesh mesh, Material[] materials, Texture terrainTexture = null)
        {
            string key = mesh.GetEntityId().ToString() + ":" + string.Join(",", materials.Select(m => m.GetEntityId().ToString())) + ":" + (terrainTexture ? terrainTexture.GetEntityId().ToString() : 0);
            if (Meshes.TryGetValue(key, out string existing)) return existing;
            using var sha = System.Security.Cryptography.SHA256.Create();
            string id = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(key)).Take(12).ToArray()).Replace("-", "").ToLowerInvariant();
            string url = $"assets/unity-levels/meshes/m_{id}.glb";
            WriteGlb(Path.Combine(Output, "meshes", $"m_{id}.glb"), mesh, materials, terrainTexture);
            Meshes[key] = url;
            return url;
        }

        static void WriteGlb(string path, Mesh mesh, Material[] materials, Texture terrainTexture)
        {
            var bin = new List<byte>();
            var views = new JArray();
            var accessors = new JArray();
            int Accessor(Array data, int components, int count, string type, int componentType, int target, float[] min = null, float[] max = null)
            {
                while (bin.Count % 4 != 0) bin.Add(0);
                int offset = bin.Count;
                if (data is float[] floats)
                    foreach (float value in floats) bin.AddRange(BitConverter.GetBytes(value));
                else if (data is int[] ints)
                    foreach (int value in ints) bin.AddRange(BitConverter.GetBytes(value));
                else if (data is uint[] uints)
                    foreach (uint value in uints) bin.AddRange(BitConverter.GetBytes(value));
                else if (data is ushort[] ushorts)
                    foreach (ushort value in ushorts) bin.AddRange(BitConverter.GetBytes(value));
                else throw new InvalidDataException(data.GetType().FullName);
                views.Add(new JObject { ["buffer"] = 0, ["byteOffset"] = offset, ["byteLength"] = bin.Count - offset, ["target"] = target });
                var accessor = new JObject { ["bufferView"] = views.Count - 1, ["componentType"] = componentType, ["count"] = count, ["type"] = type };
                if (min != null) accessor["min"] = new JArray(min);
                if (max != null) accessor["max"] = new JArray(max);
                accessors.Add(accessor);
                return accessors.Count - 1;
            }
            var vertices = mesh.vertices.Select(v => new[] { -v.x, v.y, v.z }).ToArray();
            var flatVertices = vertices.SelectMany(v => v).ToArray();
            var normals = mesh.normals.Select(n => new[] { -n.x, n.y, n.z }).ToArray();
            var flatNormals = normals.SelectMany(v => v).ToArray();
            var min = new[] { vertices.Min(v => v[0]), vertices.Min(v => v[1]), vertices.Min(v => v[2]) };
            var max = new[] { vertices.Max(v => v[0]), vertices.Max(v => v[1]), vertices.Max(v => v[2]) };
            int UvChannel(Vector2[] channel, bool flip)
            {
                var values = channel.SelectMany(v => new[] { v.x, flip ? 1f - v.y : v.y }).ToArray();
                return Accessor(values, 2, channel.Length, "VEC2", 5126, 34962);
            }
            int position = Accessor(flatVertices, 3, vertices.Length, "VEC3", 5126, 34962, min, max);
            int normal = flatNormals.Length == flatVertices.Length ? Accessor(flatNormals, 3, normals.Length, "VEC3", 5126, 34962) : position;
            int texcoord = mesh.uv.Length == vertices.Length ? UvChannel(mesh.uv, true) : Accessor(new float[vertices.Length * 2], 2, vertices.Length, "VEC2", 5126, 34962);
            int texcoord1 = mesh.uv2.Length == vertices.Length ? UvChannel(mesh.uv2, false) : -1;
            int texcoord2 = mesh.uv3.Length == vertices.Length ? UvChannel(mesh.uv3, false) : -1;
            var info = new List<Vector4>();
            var flow = new List<Vector4>();
            mesh.GetUVs(1, info);
            mesh.GetUVs(2, flow);
            int unityInfo = info.Count == vertices.Length ? Accessor(info.SelectMany(v => new[] { v.x, v.y, v.z, v.w }).ToArray(), 4, vertices.Length, "VEC4", 5126, 34962) : -1;
            int unityFlow = flow.Count == vertices.Length ? Accessor(flow.SelectMany(v => new[] { v.x, v.y, v.z, v.w }).ToArray(), 4, vertices.Length, "VEC4", 5126, 34962) : -1;
            int vertexColor = mesh.colors.Length == vertices.Length ? Accessor(mesh.colors.SelectMany(c => new[] { c.r, c.g, c.b, c.a }).ToArray(), 4, vertices.Length, "VEC4", 5126, 34962) : -1;
            var primitives = new JArray();
            var gltfMaterials = new JArray();
            var images = new JArray();
            var textures = new JArray();
            for (int submesh = 0; submesh < mesh.subMeshCount; submesh++)
            {
                var source = mesh.GetTriangles(submesh);
                var indices = new int[source.Length];
                for (int i = 0; i < source.Length; i += 3)
                {
                    indices[i] = source[i + 2];
                    indices[i + 1] = source[i + 1];
                    indices[i + 2] = source[i];
                }
                int accessor = Accessor(indices, 1, indices.Length, "SCALAR", 5125, 34963);
                var attributes = new JObject { ["POSITION"] = position, ["NORMAL"] = normal, ["TEXCOORD_0"] = texcoord };
                if (texcoord1 >= 0) attributes["TEXCOORD_1"] = texcoord1;
                if (texcoord2 >= 0) attributes["TEXCOORD_2"] = texcoord2;
                if (unityInfo >= 0) attributes["_UNITY_INFO"] = unityInfo;
                if (unityFlow >= 0) attributes["_UNITY_FLOW"] = unityFlow;
                if (vertexColor >= 0) attributes["COLOR_0"] = vertexColor;
                var primitive = new JObject
                {
                    ["attributes"] = attributes,
                    ["indices"] = accessor,
                    ["mode"] = 4,
                };
                Material material = submesh < materials.Length ? materials[submesh] : null;
                if (material || terrainTexture)
                {
                    primitive["material"] = gltfMaterials.Count;
                    gltfMaterials.Add(GltfMaterial(material, terrainTexture, images, textures, views, bin));
                }
                primitives.Add(primitive);
            }
            var doc = new JObject
            {
                ["asset"] = new JObject { ["version"] = "2.0", ["generator"] = "Spiritfire Unity scene exporter" },
                ["scene"] = 0,
                ["scenes"] = new JArray(new JObject { ["nodes"] = new JArray(0) }),
                ["nodes"] = new JArray(new JObject { ["name"] = mesh.name, ["mesh"] = 0 }),
                ["meshes"] = new JArray(new JObject { ["name"] = mesh.name, ["primitives"] = primitives }),
                ["materials"] = gltfMaterials,
                ["textures"] = textures,
                ["images"] = images,
                ["samplers"] = new JArray(new JObject { ["magFilter"] = 9729, ["minFilter"] = 9987, ["wrapS"] = 10497, ["wrapT"] = 10497 }),
                ["extensionsUsed"] = new JArray("KHR_materials_emissive_strength"),
                ["accessors"] = accessors,
                ["bufferViews"] = views,
                ["buffers"] = new JArray(new JObject { ["byteLength"] = bin.Count }),
            };
            byte[] json = Encoding.UTF8.GetBytes(doc.ToString(Formatting.None));
            using var stream = File.Create(path);
            using var writer = new BinaryWriter(stream);
            writer.Write(0x46546C67);
            writer.Write(2);
            writer.Write(12 + 8 + (json.Length + 3) / 4 * 4 + 8 + (bin.Count + 3) / 4 * 4);
            writer.Write((json.Length + 3) / 4 * 4);
            writer.Write(0x4E4F534A);
            writer.Write(json);
            for (int i = json.Length; i % 4 != 0; i++) writer.Write((byte)32);
            while (bin.Count % 4 != 0) bin.Add(0);
            writer.Write(bin.Count);
            writer.Write(0x004E4942);
            writer.Write(bin.ToArray());
        }

        static JObject GltfMaterial(Material material, Texture terrainTexture, JArray images, JArray textures, JArray views, List<byte> bin)
        {
            var pbr = new JObject { ["metallicFactor"] = material && material.HasProperty("_Metallic") ? material.GetFloat("_Metallic") : 0f, ["roughnessFactor"] = material && material.HasProperty("_Glossiness") ? 1f - material.GetFloat("_Glossiness") : 0.8f };
            var doc = new JObject { ["name"] = material ? material.name : "Terrain", ["pbrMetallicRoughness"] = pbr, ["doubleSided"] = !material || !material.HasProperty("_Cull") || material.GetFloat("_Cull") < 1.5f };
            if (material)
            {
                string renderType = material.GetTag("RenderType", false, "Opaque");
                bool transparent = material.HasProperty("_Surface") && material.GetFloat("_Surface") > 0.5f || renderType == "Transparent";
                bool cutout = material.HasProperty("_AlphaClip") && material.GetFloat("_AlphaClip") > 0.5f || renderType == "TransparentCutout";
                if (transparent) doc["alphaMode"] = "BLEND";
                else if (cutout)
                {
                    doc["alphaMode"] = "MASK";
                    doc["alphaCutoff"] = material.HasProperty("_Cutoff") ? material.GetFloat("_Cutoff") : 0.5f;
                }
            }
            Color color = material && material.HasProperty("_BaseColor") ? material.GetColor("_BaseColor") : material && material.HasProperty("_Color") ? material.GetColor("_Color") : Color.white;
            pbr["baseColorFactor"] = new JArray(color.r, color.g, color.b, color.a);
            Texture baseTexture = terrainTexture ? terrainTexture : material && material.HasProperty("_BaseMap") ? material.GetTexture("_BaseMap") : material && material.HasProperty("_MainTex") ? material.GetTexture("_MainTex") : null;
            if (baseTexture)
            {
                pbr["baseColorTexture"] = new JObject { ["index"] = textures.Count };
                images.Add(new JObject { ["uri"] = ExportTexture(baseTexture) });
                textures.Add(new JObject { ["sampler"] = 0, ["source"] = images.Count - 1 });
            }
            Texture normal = material && material.HasProperty("_BumpMap") ? material.GetTexture("_BumpMap") : null;
            if (normal)
            {
                doc["normalTexture"] = new JObject { ["index"] = textures.Count };
                images.Add(new JObject { ["uri"] = ExportTexture(normal) });
                textures.Add(new JObject { ["sampler"] = 0, ["source"] = images.Count - 1 });
            }
            if (material && material.HasProperty("_EmissionColor"))
            {
                Color emission = material.GetColor("_EmissionColor");
                float strength = Mathf.Max(emission.r, emission.g, emission.b);
                if (strength > 0)
                {
                    doc["emissiveFactor"] = new JArray(emission.r / strength, emission.g / strength, emission.b / strength);
                    if (strength > 1) doc["extensions"] = new JObject { ["KHR_materials_emissive_strength"] = new JObject { ["emissiveStrength"] = strength } };
                    else doc["emissiveFactor"] = new JArray(emission.r, emission.g, emission.b);
                    Texture emissionTexture = material.HasProperty("_EmissionMap") ? material.GetTexture("_EmissionMap") : null;
                    if (emissionTexture)
                    {
                        doc["emissiveTexture"] = new JObject { ["index"] = textures.Count };
                        images.Add(new JObject { ["uri"] = ExportTexture(emissionTexture) });
                        textures.Add(new JObject { ["sampler"] = 0, ["source"] = images.Count - 1 });
                    }
                }
            }
            if (material)
            {
                var floats = new JObject();
                var colors = new JObject();
                var vectors = new JObject();
                for (int i = 0; i < material.shader.GetPropertyCount(); i++)
                {
                    string name = material.shader.GetPropertyName(i);
                    switch (material.shader.GetPropertyType(i))
                    {
                        case ShaderPropertyType.Color:
                            colors[name] = Rgba(material.GetColor(name));
                            break;
                        case ShaderPropertyType.Float:
                        case ShaderPropertyType.Range:
                            floats[name] = material.GetFloat(name);
                            break;
                        case ShaderPropertyType.Vector:
                            var vector = material.GetVector(name);
                            vectors[name] = new JArray(vector.x, vector.y, vector.z, vector.w);
                            break;
                    }
                }
                doc["extras"] = new JObject
                {
                    ["unityShader"] = material.shader.name,
                    ["unityFloats"] = floats,
                    ["unityColors"] = colors,
                    ["unityVectors"] = vectors,
                };
            }
            return doc;
        }

        static string ExportTexture(Texture texture)
        {
            string id = texture.GetEntityId().ToString().ToString();
            if (Textures.TryGetValue(id, out string existing)) return existing;
            var readable = new RenderTexture(texture.width, texture.height, 0, RenderTextureFormat.ARGB32);
            var previous = RenderTexture.active;
            Graphics.Blit(texture, readable);
            RenderTexture.active = readable;
            var copy = new Texture2D(texture.width, texture.height, TextureFormat.RGBA32, false);
            copy.ReadPixels(new Rect(0, 0, texture.width, texture.height), 0, 0);
            copy.Apply();
            RenderTexture.active = previous;
            readable.Release();
            string url = $"../textures/{id}.png";
            File.WriteAllBytes(Path.Combine(Output, "textures", id + ".png"), copy.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(copy);
            Textures[id] = url;
            return url;
        }

        static JArray Point(Vector3 point) => new(-point.x, point.y, point.z);
        static JArray Direction(Vector3 direction) => new(-direction.x, direction.y, direction.z);
        static JArray Scale(Vector3 scale) => new(scale.x, scale.y, scale.z);
        static JArray Rotation(Quaternion rotation) => new(rotation.x, -rotation.y, -rotation.z, rotation.w);
    }
}
