"""Visible Blender entry point. Background mode is used only by automated verification."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'blender_addon'))
from chat2blend.asset_pipeline import build_robot

config = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
result = build_robot(config['output'], config.get('options'))
print('C2B_ASSET_COMPLETE', json.dumps(result['checks']))
