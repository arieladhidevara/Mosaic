"""Static startup contract for SAM 3 on ZeroGPU (no checkpoint needed)."""
import ast
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "integrations" / "hf-sam3-space" / "app.py"


class TestZeroGPUStartup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SOURCE.read_text(encoding="utf-8")
        cls.root = ast.parse(cls.text, filename=str(SOURCE))
        cls.functions = {node.name: node for node in cls.root.body
                         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def test_model_not_built_at_import(self):
        module_calls = [
            node for stmt in self.root.body
            for node in ast.walk(stmt)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "build_sam3_image_model"
            and not isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]
        self.assertEqual(module_calls, [], "SAM 3 construction must not run before ZeroGPU allocation")

    def test_both_endpoints_use_gpu_worker_model(self):
        self.assertIn("gpu_model", self.functions)
        for name in ("segment", "segment_all"):
            fn = self.functions[name]
            self.assertTrue(any(isinstance(node, ast.Call)
                                and isinstance(node.func, ast.Name)
                                and node.func.id == "gpu_model"
                                for node in ast.walk(fn)))
            self.assertTrue(any(isinstance(dec, ast.Call)
                                and isinstance(dec.func, ast.Attribute)
                                and dec.func.attr == "GPU"
                                for dec in fn.decorator_list))

    def test_spaces_before_torch(self):
        self.assertLess(self.text.index("import spaces"), self.text.index("import torch"))

    def test_model_cache(self):
        fn = self.functions["gpu_model"]
        self.assertTrue(any(isinstance(dec, ast.Call)
                            and isinstance(dec.func, ast.Name)
                            and dec.func.id == "lru_cache"
                            for dec in fn.decorator_list))

    def test_deployment_contains_every_local_python_import(self):
        workflow = SOURCE.parents[2] / '.github' / 'workflows' / 'sync-hf-space.yml'
        names = ast.literal_eval(re.search(r'required = (\[[^\n]+\])', workflow.read_text(encoding='utf-8')).group(1))
        for node in self.root.body:
            if isinstance(node, ast.ImportFrom) and node.module:
                filename = node.module + '.py'
                if (SOURCE.parent / filename).is_file():
                    self.assertIn(filename, names, 'Space deployment omits a required local module')


if __name__ == "__main__":
    unittest.main()
