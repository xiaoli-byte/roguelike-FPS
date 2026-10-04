"""Scene asset briefs. Prototype retirement was a one-time migration, now complete."""
SPECS = [
    ('SM_Prop_DesertReliquary', '沙寺镇灵碑', 'desert.statue', 'A squat sandstone shrine stele, 2.56m tall, carved sun medallion, tiered worn base, ochre stone, turquoise enamel inset, weathered carved cloud borders, thick broken edges. Width 1.5m, depth 0.8m.'),
    ('SM_Prop_DesertUrns', '沙寺陶罐组', 'desert.pots', 'Three old terracotta temple urns clustered on a shared compact sandy base, 0.83m tall and 1.25m wide, one large tied-neck urn, two smaller vessels, teal glaze on necks, ochre clay and carved simple cloud motifs. Ground clutter prop, no plants.'),
    ('SM_Prop_FrostShrine', '霜山石灯龛', 'frost.stoneLantern', 'A 2.06m tall squat carved blue-grey stone temple lantern with a thick pagoda roof under heavy snow, four stout pillars framing a warm amber light recess, tiered square base, frost and small icicles. Width and depth 0.95m.'),
    ('SM_Prop_FrostPrayerCairn', '霜山祈愿石', 'frost.crystal', 'A 2.13m tall slender asymmetrical prayer cairn made of chunky blue-grey rocks, frost and snow patches, an icy turquoise crystal embedded in the upper stone, faded crimson prayer cloth wrapped tightly around the neck, broad stable rocky base. Width 1.03m, depth 0.88m.'),
    ('SM_Prop_InfernoCrucible', '熔火祭炉', 'inferno.brazier', 'An ancient squat basalt and dark bronze ceremonial brazier, 0.97m tall and 0.9m wide, wide thick bowl holding black coals and orange embers, three chunky low feet, two small close-fitting handles, soot and weathered reliefs. No flame or smoke; embers painted into the coals.'),
    ('SM_Prop_InfernoChainObelisk', '熔火锁魂碑', 'inferno.crystal', 'A 2.13m tall broken obsidian obelisk on a heavy chipped basalt pedestal, thick bronze bands and heavy close-fitting chain wound round the waist, carved orange ember channels, cracked volcanic rock, chunky stylized silhouette. Width 1.18m and depth 0.91m.'),
]

if __name__ == '__main__':
    for asset_id, display, bind, _ in SPECS:
        print(asset_id, display, bind)
