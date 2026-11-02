import { describe, expect, it } from 'vitest';
import { auditPythonSource } from '../src/skills/index.js';

const rules = (source: string): readonly string[] => auditPythonSource('scripts/a.py', source).map((finding) => finding.rule);

describe('the patterns upstream walks an AST for', () => {
  it('flags import_module and importlib, by line', () => {
    const [finding] = auditPythonSource('scripts/a.py', 'import os\nx = importlib.import_module(name)\n');
    expect(finding?.rule).toBe('dynamic_import');
    expect(finding?.line).toBe(2);
    expect(finding?.weight).toBe('blocking');
    expect(rules('import importlib')).toEqual(['importlib_import']);
    expect(rules('import os, importlib.util as u')).toEqual(['importlib_import']);
    expect(rules('from importlib import util')).toEqual(['importlib_import']);
    expect(rules('from importlib.util import x')).toEqual(['importlib_import']);
    expect(rules('if x: import importlib')).toEqual(['importlib_import']);
    expect(rules('import os; import importlib')).toEqual(['importlib_import']);
    expect(rules('import os, \\\n  importlib')).toEqual(['importlib_import']);
  });

  it('flags a computed __import__, and a literal one passes this rule', () => {
    expect(rules('__import__(name)')).toEqual(['dynamic_import_computed']);
    expect(rules('__import__("o" + "s")')).toEqual(['dynamic_import_computed']);
    expect(rules('__import__(f"{x}")')).toEqual(['dynamic_import_computed']);
    expect(rules('__import__("json")')).toEqual([]);
    expect(rules('__import__("js" "on")')).toEqual([]);
  });

  it('flags a computed getattr, and a literal one passes this rule', () => {
    expect(rules('getattr(obj, name)')).toEqual(['dynamic_getattr']);
    expect(rules('getattr(obj, f(x))')).toEqual(['dynamic_getattr']);
    expect(rules('getattr(obj, "name")')).toEqual([]);
    expect(rules('getattr(obj, "name", make_default(a, b))')).toEqual([]);
    expect(rules('getattr(make(a, b), "name")')).toEqual([]);
    expect(rules('getattr(obj)')).toEqual([]);
  });

  it('flags a computed __dict__ key, and a literal one passes this rule', () => {
    expect(rules('obj.__dict__[name]')).toEqual(['dict_access']);
    expect(rules('obj.__dict__["name"]')).toEqual([]);
  });

  it('an alias does not pass, as it did upstream', () => {
    expect(rules('g = getattr')).toEqual(['dynamic_alias']);
    expect(rules('i = __import__')).toEqual(['dynamic_alias']);
    expect(rules('from x import import_module as i')).toEqual(['dynamic_alias']);
    expect(rules('builtins.__import__(name)')).toEqual(['dynamic_import_computed']);
  });

  it('ordinary Python passes: the positive control', () => {
    expect(rules('import os\n\ndef main(a, b=[1, 2]):\n    return {"k": a[0], "v": (b)}\n')).toEqual([]);
  });
});

describe('text that is not code', () => {
  it('a name in a string or a comment is not a call', () => {
    expect(rules('# getattr(obj, name)\n')).toEqual([]);
    expect(rules('x = "getattr(obj, name)"')).toEqual([]);
    expect(rules('x = """\nimport importlib\n"""\n')).toEqual([]);
    expect(rules("x = '''__import__(name)'''")).toEqual([]);
    expect(rules('x = r"\\"getattr(o, n)"')).toEqual([]);
  });

  it('counts lines through strings, comments and continuations', () => {
    const [finding] = auditPythonSource('scripts/a.py', 'x = """a\nb"""\n# c\ny = 1 + \\\n  2\ngetattr(o, n)\n');
    expect(finding?.line).toBe(6);
  });
});

describe('source that cannot be read', () => {
  it('is a finding, where upstream returned nothing and passed it', () => {
    for (const source of ['x = "open', 'x = """open', 'x = (1', 'x = 1)', 'x = [1)', "x = 'a\nb'"]) {
      expect(rules(source), source).toContain('unreadable_source');
    }
  });
});

describe('hostile input', () => {
  const quick = (source: string): void => {
    const started = performance.now();
    auditPythonSource('scripts/a.py', source);
    expect(performance.now() - started).toBeLessThan(2000);
  };

  it('stays linear on the shapes that break a naive reader', () => {
    const size = 262_144;
    quick('('.repeat(size));
    quick('getattr('.repeat(size / 8));
    quick('import:'.repeat(size / 7));
    quick('"'.repeat(size));
    quick('\\\n'.repeat(size / 2));
    quick('x'.repeat(size));
    quick('#\n'.repeat(size / 2));
  });
});
