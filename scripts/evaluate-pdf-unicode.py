#!/usr/bin/env python3
"""Download hash-pinned public PDF regressions and exercise the real CLI/WASM.

Python's standard library suffices. Raw outputs and private samples stay in
ignored locations. Shareable reports contain public samples only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_private_location(path):
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT):
        ignored = subprocess.run(['git', 'check-ignore', '-q', '--', str(resolved)], cwd=ROOT)
        if ignored.returncode != 0:
            raise ValueError('Private outputs/checks must be outside the repository or in a Git-ignored location')


def download(sample, cache):
    path = cache / sample['file']
    if not path.exists():
        request = Request(sample['url'], headers={'User-Agent': 'filens-pdf-unicode-evaluation'})
        with urlopen(request, timeout=60) as response:
            data = response.read((32 << 20) + 1)
        if len(data) > 32 << 20:
            raise ValueError(f"download too large: {sample['file']}")
        if hashlib.sha256(data).hexdigest() != sample['sha256']:
            raise ValueError(f"download SHA-256 mismatch: {sample['file']}")
        path.write_bytes(data)
    if digest(path) != sample['sha256']:
        raise ValueError(f"cached SHA-256 mismatch: {sample['file']}")
    return path


def extract(cli, wasm, sample, path, cache, label, timeout):
    args = [str(cli), str(path), '--json', '--timeout', f'{timeout}s']
    if not sample.get('ocr'):
        args.append('--no-ocr')
    started = time.monotonic()
    result = subprocess.run(args, env=dict(os.environ, FILENS_TEXT_WASM=str(wasm)),
                            capture_output=True, text=True, timeout=timeout + 30)
    response = json.loads(result.stdout)
    (cache / f"{sample['file']}.{label}.json").write_text(
        json.dumps(response, ensure_ascii=False, indent=2) + '\n')
    content = response.get('content', {})
    text = content.get('text', '')
    checks = {f'contains:{phrase}': phrase in text for phrase in sample.get('contains', [])}
    checks.update({f'absent:{phrase}': phrase not in text for phrase in sample.get('absent', [])})
    warnings = content.get('warnings', [])
    if 'repairedFonts' in sample:
        count = sample['repairedFonts']
        checks['fontRecovery'] = (f'Recovered PDF Unicode mappings for {count} font(s)' in warnings
                                  if count else not any(w.startswith('Recovered PDF Unicode') for w in warnings))
    if sample.get('ocr') and ('pages' in sample or 'ocrWarning' in sample):
        expected_warning = sample.get('ocrWarning', f"PDF text mapping unavailable; using OCR for {sample['pages']} page(s)")
        checks['ocrRouting'] = expected_warning in warnings
    return {
        'exit': result.returncode, 'ok': response.get('ok', False),
        'complete': content.get('complete', False), 'truncated': content.get('truncated', False),
        'seconds': round(time.monotonic() - started, 2), 'characters': len(text),
        'textSha256': hashlib.sha256(text.encode()).hexdigest(),
        # Host errors can contain absolute local paths; raw responses are kept
        # only in the ignored cache. Known recovery warnings contain no paths.
        'warnings': [w for w in warnings if w.startswith(('Recovered PDF Unicode mappings for ', 'PDF text mapping '))],
        'error': {'code': response['error'].get('code')} if response.get('error') else None,
        'checks': checks,
    }


def evaluate_sample(sample, path, args):
    path = path.resolve()
    original = digest(path)
    if 'sha256' in sample and original != sample['sha256']:
        raise ValueError(f"input SHA-256 mismatch: {sample['file']}")
    item = {k: sample[k] for k in ['file', 'issue', 'url', 'pages', 'problem', 'limitations'] if k in sample}
    item['sha256'] = original
    if args.baseline_wasm:
        item['before'] = extract(args.cli.resolve(), args.baseline_wasm.resolve(), sample, path,
                                 args.cache, 'before', args.timeout)
    after = extract(args.cli.resolve(), args.wasm.resolve(), sample, path, args.cache, 'after', args.timeout)
    if args.baseline_wasm and sample.get('unchanged'):
        after['checks']['unchangedFromBaseline'] = after['textSha256'] == item['before']['textSha256']
    after['checks']['sourceUnchanged'] = digest(path) == original
    if sample.get('ocr'):
        no_ocr = subprocess.run([str(args.cli.resolve()), str(path), '--json', '--no-ocr'],
                                env=dict(os.environ, FILENS_TEXT_WASM=str(args.wasm.resolve())),
                                capture_output=True, text=True, timeout=args.timeout + 30)
        unavailable = json.loads(no_ocr.stdout)
        # Only known OCR regressions must fail when OCR is unavailable.
        if 'pages' in sample or 'ocrWarning' in sample:
            after['checks']['missingOCRFails'] = (no_ocr.returncode == 3 and not unavailable.get('ok')
                                                  and unavailable.get('error', {}).get('code') == 'ocr_failed')
    item['after'] = after
    item['passed'] = after['ok'] and after['complete'] and not after['truncated'] and all(after['checks'].values())
    return item


def write_reports(report, private_report, destination, private_destination):
    # Keep separate objects: --report must never acquire local sample data,
    # even when a caller explicitly writes that report into docs/.
    if private_report is not None:
        require_private_location(private_destination)
        if destination.resolve() == private_destination.resolve():
            raise ValueError('Public and private report destinations must differ')
        private_destination.parent.mkdir(parents=True, exist_ok=True)
        private_destination.write_text(json.dumps(private_report, ensure_ascii=False, indent=2) + '\n')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / 'tmp/pdf-unicode-corpus')
    parser.add_argument('--cli', type=Path, default=ROOT / 'dist/filens')
    parser.add_argument('--wasm', type=Path, default=ROOT / 'wasm/converter-core-rust/target/wasm32-wasip1/release/converter-text.wasm')
    parser.add_argument('--baseline-wasm', type=Path)
    parser.add_argument('--search-sample', type=Path, help='Optional historical Search Google_C++_Guide.pdf')
    parser.add_argument('--local-pdf', type=Path, help='Optional private PDF; excluded from the shareable report')
    parser.add_argument('--local-checks', type=Path, help='Optional private JSON with sha256/contains/absent/repairedFonts checks')
    parser.add_argument('--private-report', type=Path, help='Private report destination (must be ignored or outside the repository)')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--download-only', action='store_true')
    args = parser.parse_args()
    require_private_location(args.cache)
    if args.local_checks:
        require_private_location(args.local_checks)
        if not args.local_pdf:
            parser.error('--local-checks requires --local-pdf')
    private_destination = args.private_report or args.cache / 'private-report.json'
    require_private_location(private_destination)
    if args.report and args.report.resolve() == private_destination.resolve():
        parser.error('Public and private report destinations must differ')
    args.cache.mkdir(parents=True, exist_ok=True)
    samples = json.loads((ROOT / 'docs/pdf-unicode-corpus.json').read_text())['samples']
    cases = [(s, download(s, args.cache)) for s in samples]
    control = ROOT / 'apps/demo/public/samples/filens-cosmic-atlas.pdf'
    cases.append(({'file': 'normal-cosmic-atlas.pdf', 'contains': ['COSMIC CLIFFS'], 'unchanged': True}, control))
    if args.search_sample:
        cases.append(({
            'file': 'google-cpp-guide.pdf', 'pages': 58, 'repairedFonts': 1,
            'sha256': '9482f7b83658775ffd6f313cd792364fdf3352b7f243c6ad0236d1af160336bd',
            'contains': ['大多使用', '很多强大的语言特性', '不可避免', '现有不统一代码'],
            'absent': ['大大使用', '很大强大的语言特性', '现有与统一代码'],
        }, args.search_sample))
    if args.download_only:
        print(f'Verified {len(samples)} public PDF downloads in {args.cache}')
        return
    report = {'wasmSha256': digest(args.wasm), 'samples': []}
    if args.baseline_wasm:
        report['baselineWasmSha256'] = digest(args.baseline_wasm)
    for sample, path in cases:
        item = evaluate_sample(sample, path, args)
        report['samples'].append(item)
        after = item['after']
        print(f"{'PASS' if item['passed'] else 'FAIL'} {sample['file']}: {after['characters']} characters, {after['seconds']}s", flush=True)
    report['wasmUnchanged'] = digest(args.wasm) == report['wasmSha256']
    report['passed'] = report['wasmUnchanged'] and all(item['passed'] for item in report['samples'])
    private_report = None
    if args.local_pdf:
        checks = json.loads(args.local_checks.read_text()) if args.local_checks else {}
        allowed = {'sha256', 'contains', 'absent', 'repairedFonts', 'ocr', 'pages', 'ocrWarning'}
        if set(checks) - allowed:
            raise ValueError('Unsupported private check fields')
        sample = dict(checks, file='private-local-sample.pdf')
        item = evaluate_sample(sample, args.local_pdf, args)
        private_report = {'private': True, 'wasmSha256': report['wasmSha256'], 'samples': [item], 'passed': item['passed']}
        print(f"{'PASS' if item['passed'] else 'FAIL'} private local sample; details stay in the private cache", flush=True)
    destination = args.report or args.cache / 'report.json'
    write_reports(report, private_report, destination, private_destination)
    print(destination)
    raise SystemExit(0 if report['passed'] and (private_report is None or private_report['passed']) else 1)


if __name__ == '__main__':
    main()
