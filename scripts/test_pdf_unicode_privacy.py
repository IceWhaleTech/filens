"""Privacy boundaries for the shareable PDF evaluation report (standard library)."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pdf_eval', Path(__file__).with_name('evaluate-pdf-unicode.py'))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class ReportPrivacyTests(unittest.TestCase):
    def test_private_details_never_enter_public_report(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            public = {'samples': [{'file': 'public.pdf', 'passed': True}], 'passed': True}
            private = {'private': True, 'samples': [{'file': 'private.pdf', 'sha256': 'PRIVATE_FINGERPRINT',
                                                    'checks': {'contains:PRIVATE_DOCUMENT_TEXT': True}}]}
            destination = root / 'shareable.json'
            private_destination = root / 'ignored/private.json'
            evaluation.write_reports(public, private, destination, private_destination)
            self.assertNotIn('PRIVATE_', destination.read_text())
            self.assertEqual(json.loads(private_destination.read_text()), private)

    def test_rejects_private_files_in_versioned_location(self):
        with self.assertRaisesRegex(ValueError, 'Git-ignored'):
            evaluation.require_private_location(evaluation.ROOT / 'docs/private.json')
        evaluation.require_private_location(evaluation.ROOT / 'tmp/private-checks.json')

    def test_rejects_shared_public_private_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'report.json'
            with self.assertRaisesRegex(ValueError, 'must differ'):
                evaluation.write_reports({}, {'private': True}, destination, destination)
            self.assertFalse(destination.exists())

    def test_error_paths_and_unexpected_warnings_stay_in_raw_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            response = {'ok': False, 'error': {'code': 'io_error', 'message': 'PRIVATE_PATH'},
                        'content': {'text': '', 'warnings': ['PRIVATE_PATH']}}
            fake = type('Response', (), {'returncode': 3, 'stdout': json.dumps(response)})()
            with patch.object(evaluation.subprocess, 'run', return_value=fake):
                result = evaluation.extract(root / 'cli', root / 'core.wasm', {'file': 'public.pdf'},
                                            root / 'public.pdf', root, 'after', 10)
            self.assertNotIn('PRIVATE_PATH', json.dumps(result))
            self.assertIn('PRIVATE_PATH', (root / 'public.pdf.after.json').read_text())


if __name__ == '__main__':
    unittest.main()
