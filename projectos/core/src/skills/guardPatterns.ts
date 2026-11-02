// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/skills_guard.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; every open repeat bounded; the conditional in destructive_root_rm rewritten as an alternation, because JavaScript has none; the upstream home directory patterns renamed and extended to .projectops, one pattern added for governance records; two ids split so each pattern has its own; role_hijack narrowed as memory narrows it; html_comment_injection dropped, because hiddenText refuses every comment with no keyword needed
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The threat patterns: what a skill must not say, as data, with no I/O.
 *
 * WHAT THE TRANSLATION HAD TO CHANGE. Python's `\w` is Unicode-aware and JavaScript's is ASCII, so the word
 * fillers use `WORD`, or a filler in another script would pass. JavaScript has no regex conditional. Every
 * `*` and `+` over text is bounded, because the whole file is one haystack here and `.*` after a repeated
 * word is quadratic. Two wide repeats in one pattern multiply, so a pattern that needs two uses the narrow gap. `^\s*` became a bounded `[ \t]` run for the same reason: under the `m` flag `\s` crosses lines, and a
 * file of blank lines would make it quadratic.
 *
 * WHAT A CLEAN RESULT MEANS. Nothing: a pattern list cannot prove text is safe. A hit stops or informs a
 * promotion. A miss means no listed pattern matched, so a promoted skill stays fenced as untrusted data.
 */

export const SKILL_THREAT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type SkillThreatSeverity = (typeof SKILL_THREAT_SEVERITIES)[number];

export interface SkillThreatPattern {
  readonly id: string;
  readonly severity: SkillThreatSeverity;
  readonly category: string;
  readonly source: string;
  readonly description: string;
}

const row = (id: string, severity: SkillThreatSeverity, category: string, source: string, description: string): SkillThreatPattern => ({ id, severity, category, source, description });

const WORD = String.raw`[\p{L}\p{N}_]`;
const FILLER = String.raw`(?:${WORD}{1,64}\s+){0,8}`;
/** The rest of one line, bounded. */
const ANY = String.raw`[^\n]{0,512}`;
/** The gap when a pattern needs two repeats. Their product is what a hostile line costs at each start. */
const NEAR = String.raw`[^\n]{0,64}`;
const TICK = '`';
const NOT_LOOPBACK = String.raw`(?!${ANY}https?://(?:localhost|127\.0\.0\.1|\[::1\]))`;
const SECRET_NAME = '(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)';
const SECRET_NAME_SHORT = '(?:KEY|TOKEN|SECRET|PASSWORD)';
const SECRET_VAR = String.raw`\$\{?${WORD}{0,64}${SECRET_NAME}S?\b`;
const SECRET_VAR_SHORT = String.raw`\$\{?${WORD}{0,64}${SECRET_NAME_SHORT}S?\b`;
const SHELLS = String.raw`(?:bash|sh|zsh|ksh|dash)\b`;
const SUDO = String.raw`(?:sudo\s+(?:-\S{1,16}\s+){0,4})?`;

const CRED_FILE = String.raw`(?:\.ssh[/\\]id_(?:rsa|ed25519|ecdsa|dsa)(?!\.pub)|\.env\b|credentials\b|\.netrc\b|\.pgpass\b|\.npmrc\b|\.pypirc\b)`;
const CRED_FILE_LITERAL = String.raw`["'][^"'\n]{0,64}${CRED_FILE}[^"'\n]{0,64}["']`;
const PY_CRED_FILE_ARG = String.raw`(?:os\.path\.expanduser\s*\(\s*)?${CRED_FILE_LITERAL}\s*\)?`;

const DNS_FLAGS = String.raw`(?:[-+@]\S{0,16}(?:\s+[^\s$"'-][^\s$]{0,16})?\s+){0,8}`;
const DNS_VAR = String.raw`\$(?:\{[^}\s]{0,16}\}|\([^\n]{0,64}?\)+|\w{1,64})`;

const TEMP_ROOTS = '(?:tmp|var/tmp|dev/shm|run|var/lib/apt/lists|var/cache/(?:apt|apk|yum|dnf))';
const RM_ROOT_TAIL = String.raw`(?:(?!${TEMP_ROOTS}(?:\b|/))|${TEMP_ROOTS}/(?:[^/\s]{0,64}/){0,16}\.\.(?=/|[\s;&|]|$))`;

const MODIFY_VERB =
  String.raw`(?:\bwrit(?:e|es|ing)\b|\bwritten\b|\bedit(?:s|ed|ing)?\b|\bmodif(?:y|ies|ied|ying|ication)s?\b|\bupdat(?:e|es|ed|ing)\b` +
  String.raw`|\bappend(?:s|ed|ing)?\b|\bprepend(?:s|ed|ing)?\b|\binject(?:s|ed|ing)?\b|\boverwrit(?:e|es|ing)\b|\boverwritten\b` +
  String.raw`|\breplac(?:e|es|ed|ing)\b|\balter(?:s|ed|ing)?\b|\badd(?:s|ed|ing)\b)`;
const AGENT_CONFIG_FILES = String.raw`(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`;
const AGENT_HOME_FILES = String.raw`\.(?:hermes|projectops)/(?:config\.yaml|SOUL\.md)`;
const OTHER_AGENT_FILES = String.raw`\.(?:claude/settings|codex/config)[\w.]{0,64}`;

function shellWrite(file: string): string {
  return [
    String.raw`(?:>>|[\w"'${TICK})\]]\s*>)\s*[~\w./-]{0,256}${file}(?!\.?\w)`,
    String.raw`\bsed\s+(?:\S{1,64}\s+){0,4}?(?:-[A-Za-z]{0,8}i[A-Za-z]{0,8}|--in-place)\s+${NEAR}${file}(?!\.?\w)`,
    String.raw`\btee\s+(?:-a\s+)?[~\w./"'-]{0,256}${file}(?!\.?\w)`,
    String.raw`\b(?:cp|mv)\s+[^\s|;&]{1,64}\s+[^\n|;&]{0,40}?${file}(?!\.?\w)`,
  ].join('|');
}

function proseModify(file: string): string {
  return (
    String.raw`^[ \t]{0,64}(?:[-*+]\s+|\d{1,9}[.)]\s+)?${MODIFY_VERB}[^\n,]{0,80}?${file}\b` +
    String.raw`|(?:\byou\s+(?:must|should|need\s+to)\s+|\bplease\s+|\bmake\s+sure\s+(?:to\s+|you\s+)|\bbe\s+sure\s+to\s+)` +
    String.raw`${MODIFY_VERB}[^\n,]{0,80}?${file}\b`
  );
}

const contentContract = (file: string): string => String.raw`${file}\b[^\n]{0,40}?\b(?:should|must|needs?\s+to)\s+(?:contain|say|include|have|list)\b`;

const NO_TRANSFER = String.raw`(?!(?:\w{1,64}\s+){0,4}?(?:never|not|no|doesn'?t|didn'?t|won'?t|isn'?t|aren'?t|can'?t|cannot|mustn'?t|shouldn'?t)\b)`;
const SHORT_FILLER = String.raw`(?:\w{1,64}\s+){0,3}?`;
const NOT_DELEGATE =
  String.raw`(?!(?:(?:the|your|each|every|all|to|a)\s+)?(?:sub-?agents?|sub-?tasks?)\b` +
  String.raw`|(?:(?:the|your|each|every|all|to|a)\s+)(?:workers?|delegates?|children|child)\b)`;
const CONTEXT_SCOPE = String.raw`(?:your|their|our|its|the\s+(?:full|entire|whole|complete|current)|full|entire|whole|complete|current|conversation|session|chat)\s+`;
const CONTEXT_DEST = String.raw`(?:\s+(?:to|at|with)\b)`;
const CONTEXT_DATIVE = String.raw`(?:[a-z]{1,64}s\s+)(?:the|a|an)\s+context\b`;

export const SKILL_THREAT_PATTERNS: readonly SkillThreatPattern[] = [
  // Exfiltration: shell commands leaking secrets. A loopback destination cannot move data off the machine.
  row('env_exfil_curl', 'critical', 'exfiltration', String.raw`curl\s+${NOT_LOOPBACK}${ANY}${SECRET_VAR}`, 'curl command interpolating a secret environment variable'),
  row('env_exfil_wget', 'critical', 'exfiltration', String.raw`wget\s+${NOT_LOOPBACK}${ANY}${SECRET_VAR}`, 'wget command interpolating a secret environment variable'),
  row('env_exfil_fetch', 'critical', 'exfiltration', String.raw`fetch\s*\(${NOT_LOOPBACK}${ANY}${SECRET_VAR_SHORT}`, 'fetch() call interpolating a secret environment variable'),
  row('env_exfil_httpx', 'critical', 'exfiltration', String.raw`httpx?\.(?:get|post|put|patch)\s*\(${NOT_LOOPBACK}${ANY}${SECRET_NAME_SHORT}`, 'HTTP library call with a secret variable'),
  row('env_exfil_requests', 'critical', 'exfiltration', String.raw`requests\.(?:get|post|put|patch)\s*\(${NOT_LOOPBACK}${ANY}${SECRET_NAME_SHORT}`, 'requests library call with a secret variable'),
  // Exfiltration: reading credential stores.
  row('encoded_exfil', 'high', 'exfiltration', String.raw`base64${ANY}env`, 'base64 encoding combined with environment access'),
  row('ssh_dir_access', 'high', 'exfiltration', String.raw`(?:\$HOME|~)/\.ssh`, 'references the user SSH directory'),
  row('aws_dir_access', 'high', 'exfiltration', String.raw`(?:\$HOME|~)/\.aws`, 'references the user AWS credentials directory'),
  row('gpg_dir_access', 'high', 'exfiltration', String.raw`(?:\$HOME|~)/\.gnupg`, 'references the user GPG keyring'),
  row('kube_dir_access', 'high', 'exfiltration', String.raw`(?:\$HOME|~)/\.kube`, 'references the Kubernetes config directory'),
  row('docker_dir_access', 'high', 'exfiltration', String.raw`(?:\$HOME|~)/\.docker`, 'references Docker config, which may hold registry credentials'),
  row('agent_home_env_access', 'critical', 'exfiltration', String.raw`(?:\$HOME|~)/\.(?:hermes|projectops)/\.env`, 'directly references an agent secrets file'),
  row('read_secrets_file', 'critical', 'exfiltration', String.raw`cat\s+(?!>)${ANY}(?:\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, 'reads a known secrets file'),
  row('js_read_secrets_file', 'critical', 'exfiltration', String.raw`\b(?:readFile(?:Sync)?|readTextFile)\s*\(\s*${CRED_FILE_LITERAL}`, 'JavaScript reads a known credential file'),
  row(
    'py_read_secrets_file',
    'critical',
    'exfiltration',
    String.raw`\bopen\s*\(\s*${PY_CRED_FILE_ARG}(?!\s*\)?\s*,\s*["'][^"'\n]{0,16}[wax][^"'\n]{0,16}["'])(?!${ANY}\bmode\s*=\s*["'][^"'\n]{0,16}[wax])|\bPath\s*\(\s*${PY_CRED_FILE_ARG}\s*\)\.(?:read_text|read_bytes|readlines|readline)\s*\(`,
    'Python reads a known credential file',
  ),
  // Exfiltration: programmatic environment access.
  row('dump_all_env', 'high', 'exfiltration', String.raw`printenv|(?<![A-Za-z0-9_])env\s*\|(?!\|)(?!\s*[{(])`, 'dumps all environment variables'),
  row('python_os_environ', 'high', 'exfiltration', String.raw`^[^#\n]{0,4096}os\.environ\b(?!\s*\.get\s*\()`, 'accesses os.environ outside a comment'),
  row('python_environ_get_secret', 'medium', 'exfiltration', String.raw`os\.environ\s*\.get\s*\(\s*["'][^"'\n]{0,128}${SECRET_NAME}`, 'reads a secret via os.environ.get()'),
  row('python_getenv_secret', 'medium', 'exfiltration', String.raw`os\.getenv\s*\(\s*[^)\n]{0,256}${SECRET_NAME}`, 'reads a secret via os.getenv()'),
  row('node_process_env', 'high', 'exfiltration', String.raw`process\.env\[`, 'reads the Node.js environment table'),
  row('ruby_env_secret', 'critical', 'exfiltration', String.raw`(?-i:ENV)\[${ANY}${SECRET_NAME_SHORT}`, 'reads a secret via Ruby ENV[]'),
  // Exfiltration: DNS and staging. Data travels in the queried name, as a subdomain of the attacker's domain.
  row(
    'dns_exfil',
    'critical',
    'exfiltration',
    String.raw`(?<![-/])\b(?:dig|nslookup)\s+${DNS_FLAGS}["']?[^\s"'$()]{0,64}${DNS_VAR}[\w-]{0,128}["']?\.[a-z]|(?<![-/])\bhost\s+${DNS_FLAGS}["']?[^\s"'$()]{0,64}${DNS_VAR}[\w-]{0,128}\.[a-z]|(?:^|[;&|]|\$\(|\b(?:do|then|else)\b)[ \t]{0,64}host\s+${DNS_FLAGS}["']?\$`,
    'DNS lookup with variable interpolation',
  ),
  row('tmp_staging', 'critical', 'exfiltration', String.raw`>\s*/tmp/\S{0,256}\s*&&\s*(?:curl|wget|nc|python)`, 'writes to a temporary path and then sends it'),
  row('md_image_exfil', 'high', 'exfiltration', String.raw`!\[[^\]\n]{0,64}\]\(https?://[^)\n]{0,64}\$\{?`, 'markdown image URL with variable interpolation'),
  row('md_link_exfil', 'high', 'exfiltration', String.raw`\]\(https?://[^)\n]{0,512}\$\{?`, 'markdown link with variable interpolation'),
  // Prompt injection.
  row('prompt_injection_ignore', 'critical', 'injection', String.raw`ignore\s+${FILLER}(?:previous|all|above|prior)\s+instructions`, 'prompt injection: ignore previous instructions'),
  row('role_hijack', 'high', 'injection', String.raw`you\s+are\s+${FILLER}now\s+(?:a|an|the)\s+`, 'attempts to override the role of the reader'),
  row(
    'deception_hide',
    'high',
    'injection',
    String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user(?!\s+to\s+["'“‘])(?!${ANY}\b(?:unless|except|until|confirm|diagnos\w{0,16}|verify|check)\b)`,
    'instructs the reader to hide information from the user',
  ),
  row('sys_prompt_override', 'critical', 'injection', String.raw`system\s+${FILLER}prompt\s+${FILLER}override`, 'attempts to override the system prompt'),
  row('role_pretend', 'high', 'injection', String.raw`pretend\s+${FILLER}(?:you\s+are|to\s+be)\s+`, 'attempts to make the reader assume a different identity'),
  row('disregard_rules', 'critical', 'injection', String.raw`disregard\s+${FILLER}(?:your|all|any)\s+${FILLER}(?:instructions|rules|guidelines)`, 'instructs the reader to disregard its rules'),
  row('leak_system_prompt', 'high', 'injection', String.raw`output\s+${FILLER}(?:system|initial)\s+prompt`, 'attempts to extract the system prompt'),
  row('conditional_deception', 'high', 'injection', String.raw`(?:when|if)\s+no\s*one\s+is\s+(?:watching|looking)`, 'conditional instruction to behave differently when unobserved'),
  row('bypass_restrictions', 'critical', 'injection', String.raw`act\s+as\s+(?:if|though)\s+${FILLER}you\s+${FILLER}(?:have\s+no|don't\s+have)\s+${FILLER}(?:restrictions|limits|rules)`, 'instructs the reader to act without restrictions'),
  row('translate_execute', 'critical', 'injection', String.raw`translate\s+${ANY}\s+into\s+${WORD}{1,64}(?:[\s-]{1,8}${WORD}{1,64}){0,2}\s+and\s+(?:execute|run|eval)\b`, 'translate-then-execute evasion'),
  row('hidden_div', 'high', 'injection', String.raw`<\s*div\s+style\s*=\s*["'][^>\n]{0,512}display\s*:\s*none`, 'hidden HTML div'),
  // Destructive operations. Cleanup under the standard temporary roots is routine; a climb out of them is not.
  row('destructive_root_rm', 'critical', 'destructive', String.raw`rm\s+-rf\s+(?:/|(?:[^\s;&|<>#][^\s;&|<>]{0,64}\s+){1,32}?/(?!/(?:\s|$)))${RM_ROOT_TAIL}`, 'recursive delete from root'),
  row('destructive_home_rm', 'critical', 'destructive', String.raw`(?<![A-Za-z0-9])rm\s+(?:-\S{0,16})?r${ANY}(?:\$HOME|~[/\s*]|~$)|(?<![A-Za-z0-9])rmdir\s+${ANY}(?:\$HOME|~[/\s*]|~$)`, 'recursive delete targeting the home directory'),
  row('insecure_perms', 'medium', 'destructive', String.raw`chmod\s+777`, 'sets world-writable permissions'),
  row('system_overwrite', 'critical', 'destructive', String.raw`>\s*/etc/`, 'overwrites a system configuration file'),
  row('format_filesystem', 'critical', 'destructive', String.raw`\bmkfs\b`, 'formats a filesystem'),
  row('disk_overwrite', 'critical', 'destructive', String.raw`\bdd\s+(?=${NEAR}\bif=)${NEAR}\bof=/dev/`, 'raw disk write'),
  row('python_rmtree', 'high', 'destructive', String.raw`shutil\.rmtree\s*\(\s*["'/]`, 'Python rmtree on an absolute or root-relative path'),
  row('truncate_system', 'critical', 'destructive', String.raw`truncate\s+-s\s*0\s+/`, 'truncates a system file to zero bytes'),
  // Persistence.
  row('persistence_cron', 'medium', 'persistence', String.raw`\bcrontab\b`, 'modifies cron jobs'),
  row('shell_rc_mod', 'medium', 'persistence', String.raw`\.(?:bashrc|zshrc|bash_profile|bash_login|zprofile|zlogin)\b`, 'references a shell startup file'),
  row('shell_profile_mod', 'medium', 'persistence', String.raw`(?<![\w)\]?])\.profile\b`, 'references the shell profile'),
  row('ssh_backdoor', 'critical', 'persistence', String.raw`authorized_keys`, 'modifies SSH authorized keys'),
  row('ssh_keygen', 'medium', 'persistence', String.raw`ssh-keygen`, 'generates SSH keys'),
  row('systemd_service', 'medium', 'persistence', String.raw`systemd${ANY}\.service|systemctl\s+(?:enable|start)`, 'references or enables a systemd service'),
  row('init_script', 'medium', 'persistence', String.raw`/etc/init\.d/`, 'references an init.d startup script'),
  row('macos_launchd', 'medium', 'persistence', String.raw`launchctl\s+load|LaunchAgents|LaunchDaemons`, 'macOS launch agent persistence'),
  row('sudoers_mod', 'critical', 'persistence', String.raw`/etc/sudoers|visudo`, 'modifies sudoers'),
  row('git_config_global', 'medium', 'persistence', String.raw`git\s+config\s+--global\s+`, 'modifies global git configuration'),
  // Network: reverse shells and tunnels.
  row('reverse_shell', 'critical', 'network', String.raw`\bnc\s+-[lp]|ncat\s+-[lp]|\bsocat\b${ANY}\b(?:tcp|udp|openssl|ssl|exec|system|pty|unix)[\w-]{0,32}:`, 'potential reverse shell listener'),
  row('tunnel_service', 'high', 'network', String.raw`\bngrok\b|\blocaltunnel\b|\bserveo\b|\bcloudflared\b`, 'uses a tunnelling service for external access'),
  row('hardcoded_ip_port', 'medium', 'network', String.raw`\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}`, 'hardcoded IP address with a port'),
  row('bind_all_interfaces', 'high', 'network', String.raw`0\.0\.0\.0:\d|INADDR_ANY`, 'binds to all network interfaces'),
  row('bash_reverse_shell', 'critical', 'network', String.raw`/bin/${SHELLS}\s+-i\s+${ANY}>/dev/tcp/`, 'interactive reverse shell via /dev/tcp'),
  row('python_socket_oneliner', 'critical', 'network', String.raw`python[23]?\s+-c\s+["']import\s+socket`, 'Python one-liner socket connection'),
  row('python_socket_connect', 'high', 'network', String.raw`socket\.connect\s*\(\s*\(`, 'Python socket connect to an arbitrary host'),
  row('exfil_service', 'high', 'network', String.raw`webhook\.site|requestbin\.com|pipedream\.net|hookbin\.com`, 'references a known exfiltration or webhook testing service'),
  row('paste_service', 'medium', 'network', String.raw`pastebin\.com|hastebin\.com|ghostbin\.`, 'references a paste service'),
  // Obfuscation: encoding and eval.
  row(
    'base64_decode_pipe',
    'high',
    'obfuscation',
    String.raw`(?:\bbase64\s+(?:-[^\s|]{1,16}\s+){0,4}?(?:-[a-z]{0,8}d[a-z]{0,8}|--decode)\b|\bopenssl\s+(?:base64|enc)\b[^|;&\n]{0,64}?\s-d\b)[^\n]{0,64}?(?:\||;|&&)\s*(?:\w{1,64}=\S{0,16}\s+){0,4}(?:\S{0,16}/)?(?:sh|bash|zsh|ksh|dash|fish|python[\d.]{0,8}|perl|ruby|node|nodejs|php|eval|source|exec|xargs|env|sudo|iex|pwsh|powershell|tar|bsdtar|unzip|cpio|gunzip|gzip|zcat|xz|unxz|bunzip2|\.(?=\s))(?![\w.-])|\b(?:eval|source|iex|exec)\b${ANY}\bbase64\s+(?:-[^\s|]{1,16}\s+){0,4}?(?:-[a-z]{0,8}d[a-z]{0,8}|--decode)\b`,
    'base64 decodes and pipes to execution',
  ),
  row('hex_encoded_string', 'medium', 'obfuscation', String.raw`\\x[0-9a-f]{2}${NEAR}\\x[0-9a-f]{2}${NEAR}\\x[0-9a-f]{2}`, 'hex-encoded string'),
  row('eval_string', 'high', 'obfuscation', String.raw`\beval\s*\(\s*["']`, 'eval() with a string argument'),
  row(
    'exec_string',
    'high',
    'obfuscation',
    String.raw`(?<![.\w])exec\s*\(\s*["'](?!(?-i:PRAGMA|BEGIN|COMMIT|ROLLBACK|CREATE|INSERT|SELECT|UPDATE|DELETE|DROP|ALTER|VACUUM|SAVEPOINT|RELEASE|ANALYZE|REINDEX|ATTACH|DETACH|REPLACE)\b)`,
    'exec() with a string argument',
  ),
  row('echo_pipe_exec', 'critical', 'obfuscation', String.raw`echo\s+${ANY}\|\s*(?:${SHELLS}|python|perl|ruby|node)`, 'echo piped to an interpreter'),
  row('python_compile_exec', 'high', 'obfuscation', String.raw`compile\s*\(\s*[^)\n]{1,64},\s*["'][^"'\n]{0,64}["']\s*,\s*["']exec["']\s*\)`, 'Python compile() with exec mode'),
  row('python_getattr_builtins', 'high', 'obfuscation', String.raw`getattr\s*\(\s*__builtins__`, 'dynamic access to Python builtins'),
  row('python_import_os', 'high', 'obfuscation', String.raw`__import__\s*\(\s*["']os["']\s*\)`, 'dynamic import of the os module'),
  row('python_codecs_decode', 'medium', 'obfuscation', String.raw`codecs\.decode\s*\(\s*["']`, 'codecs.decode, possible ROT13'),
  row('js_char_code', 'medium', 'obfuscation', String.raw`String\.fromCharCode|charCodeAt`, 'JavaScript character code construction'),
  row('js_base64', 'medium', 'obfuscation', String.raw`atob\s*\(|btoa\s*\(`, 'JavaScript base64 encode or decode'),
  row('string_reversal', 'low', 'obfuscation', String.raw`\[::-1\]`, 'string reversal'),
  row('chr_building', 'high', 'obfuscation', String.raw`chr\s*\(\s*\d{1,8}\s*\)\s*\+\s*chr\s*\(\s*\d`, 'building a string from chr() calls'),
  row('unicode_escape_chain', 'medium', 'obfuscation', String.raw`\\u[0-9a-f]{4}${NEAR}\\u[0-9a-f]{4}${NEAR}\\u[0-9a-f]{4}`, 'chain of unicode escapes'),
  // Process execution in scripts.
  row('python_subprocess', 'medium', 'execution', String.raw`subprocess\.(?:run|call|Popen|check_output)\s*\(`, 'Python subprocess execution'),
  row('python_os_system', 'high', 'execution', String.raw`os\.system\s*\(`, 'os.system(), unguarded shell execution'),
  row('python_os_popen', 'high', 'execution', String.raw`os\.popen\s*\(`, 'os.popen(), shell pipe execution'),
  row('node_child_process', 'high', 'execution', String.raw`child_process\.(?:exec|spawn|fork)\s*\(`, 'Node.js child_process execution'),
  row('java_runtime_exec', 'high', 'execution', String.raw`Runtime\.getRuntime\(\)\.exec\(`, 'Java Runtime.exec(), shell execution'),
  row('backtick_subshell', 'medium', 'execution', `${TICK}[^${TICK}\\n]{0,64}\\$\\([^)\\n]{1,16}\\)[^${TICK}\\n]{0,16}${TICK}`, 'backtick string with command substitution'),
  row('inline_shell_exec', 'high', 'execution', `!${TICK}[^${TICK}\\s][^${TICK}\\n]{0,512}${TICK}`, 'inline shell snippet, which upstream expands on load'),
  // Path traversal.
  row('path_traversal_deep', 'high', 'traversal', String.raw`\.\./\.\./\.\.`, 'deep relative path traversal'),
  row('path_traversal', 'medium', 'traversal', String.raw`\.\./\.\.`, 'relative path traversal'),
  row('system_passwd_access', 'critical', 'traversal', String.raw`/etc/passwd|/etc/shadow`, 'references system password files'),
  row('proc_access', 'high', 'traversal', String.raw`/proc/self|/proc/\d{1,8}/`, 'references the /proc filesystem'),
  row('dev_shm', 'medium', 'traversal', String.raw`/dev/shm/`, 'references shared memory, a common staging area'),
  // Crypto mining.
  row('crypto_mining', 'critical', 'mining', String.raw`xmrig|stratum\+tcp|monero|coinhive|cryptonight`, 'cryptocurrency mining reference'),
  row('mining_indicators', 'medium', 'mining', String.raw`hashrate|nonce${ANY}difficulty`, 'possible cryptocurrency mining indicators'),
  // Supply chain: a download piped to a shell.
  row('curl_pipe_shell', 'critical', 'supply_chain', String.raw`curl\s+[^|\s]${ANY}\|\s*${SUDO}${SHELLS}`, 'curl piped to a shell'),
  row('wget_pipe_shell', 'critical', 'supply_chain', String.raw`wget\s+${ANY}-O\s*-\s*\|\s*${SUDO}${SHELLS}`, 'wget piped to a shell'),
  row('curl_pipe_python', 'critical', 'supply_chain', String.raw`curl\s+[^|\s]${ANY}\|\s*${SUDO}python`, 'curl piped to Python'),
  // Supply chain: unpinned or deferred dependencies.
  row('pep723_inline_deps', 'medium', 'supply_chain', String.raw`#\s*///\s*script${ANY}dependencies`, 'inline script metadata with dependencies'),
  row('unpinned_pip_install', 'medium', 'supply_chain', String.raw`pip\s+install\s+(?!-r\s)(?!${ANY}==)`, 'pip install without version pinning'),
  row('unpinned_npm_install', 'medium', 'supply_chain', String.raw`npm\s+install\s+(?!${ANY}@\d)`, 'npm install without version pinning'),
  row('uv_run', 'medium', 'supply_chain', String.raw`\buv\s+run\s+`, 'uv run, which may install unpinned dependencies'),
  row('remote_fetch', 'medium', 'supply_chain', String.raw`(?:curl|wget|httpx?\.get|requests\.get|fetch)\s*\(?\s*["']https?://`, 'fetches a remote resource at runtime'),
  row('git_clone', 'medium', 'supply_chain', String.raw`git\s+clone\s+`, 'clones a git repository at runtime'),
  row('docker_pull', 'medium', 'supply_chain', String.raw`docker\s+pull\s+`, 'pulls a Docker image at runtime'),
  // Privilege escalation.
  row('allowed_tools_field', 'low', 'privilege_escalation', String.raw`^allowed-tools\s*:`, 'declares allowed-tools, which grants nothing here'),
  row('sudo_usage', 'high', 'privilege_escalation', String.raw`\bsudo\b(?!\.\w)`, 'uses sudo'),
  row(
    'setuid_setgid',
    'critical',
    'privilege_escalation',
    String.raw`(?<![a-z])set(?:e|re|res)?[ug]id\s*\(|\bcap_set[ug]id\b|\bchmod\s+(?:-\w{1,16}\s+){0,4}(?:[ugoa]{0,4}[+=][rwxXt]{0,6}s|0?[2-7][0-7]{3}\b)`,
    'setuid or setgid in an executing shape',
  ),
  row('setuid_mention', 'medium', 'privilege_escalation', String.raw`(?<!cap_)set[ug]id(?!\s*\()`, 'mentions setuid or setgid'),
  row('nopasswd_sudo', 'critical', 'privilege_escalation', String.raw`NOPASSWD`, 'NOPASSWD sudoers entry'),
  row('suid_bit', 'critical', 'privilege_escalation', String.raw`chmod\s+[u+]?s`, 'sets the SUID or SGID bit'),
  // Persistence through agent configuration. A bare mention is not a threat; an instruction to change one is.
  row('agent_config_mod', 'critical', 'persistence', proseModify(AGENT_CONFIG_FILES), 'instructs modification of agent config files'),
  row('agent_config_mod_shell', 'critical', 'persistence', shellWrite(AGENT_CONFIG_FILES), 'shell write targeting agent config files'),
  row('agent_config_contract', 'high', 'persistence', contentContract(AGENT_CONFIG_FILES), 'dictates agent config file contents'),
  row('agent_config_ref', 'low', 'persistence', String.raw`AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules`, 'references agent config files'),
  row('agent_home_config_mod', 'high', 'persistence', proseModify(AGENT_HOME_FILES), 'modification language aimed at agent home configuration'),
  row('agent_home_config_mod_shell', 'critical', 'persistence', shellWrite(AGENT_HOME_FILES), 'shell write targeting agent home configuration'),
  row('agent_home_config_ref', 'low', 'persistence', AGENT_HOME_FILES, 'references agent home configuration'),
  row('other_agent_config_mod', 'high', 'persistence', proseModify(OTHER_AGENT_FILES), 'modifies the configuration of another agent'),
  row('other_agent_config_mod_shell', 'critical', 'persistence', shellWrite(OTHER_AGENT_FILES), 'shell write targeting the configuration of another agent'),
  row('other_agent_config_ref', 'low', 'persistence', String.raw`\.claude/settings|\.codex/config`, 'references the configuration of another agent'),
  row('governance_record_mod', 'critical', 'persistence', String.raw`${MODIFY_VERB}${ANY}\.projectops/`, 'instructs a change to governance records'),
  // Hardcoded secrets. A value that is itself an environment-variable name says where a credential lives.
  row(
    'hardcoded_secret',
    'critical',
    'credential_exposure',
    String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'](?!(?-i:[A-Z][A-Z0-9]{0,64}(?:_[A-Z0-9]{1,64}){1,16})["'])[A-Za-z0-9+/=_-]{20,}`,
    'possible hardcoded API key, token or secret',
  ),
  row('embedded_private_key', 'critical', 'credential_exposure', String.raw`(?-i:-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----)`, 'embedded private key'),
  row('github_token_leaked', 'critical', 'credential_exposure', String.raw`(?-i:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{80,})`, 'GitHub personal access token'),
  row('openai_key_leaked', 'critical', 'credential_exposure', String.raw`(?-i:sk-[A-Za-z0-9]{20,})`, 'possible OpenAI API key'),
  row('anthropic_key_leaked', 'critical', 'credential_exposure', String.raw`(?-i:sk-ant-[A-Za-z0-9_-]{90,})`, 'possible Anthropic API key'),
  row('aws_access_key_leaked', 'critical', 'credential_exposure', String.raw`(?-i:AKIA[0-9A-Z]{16})`, 'AWS access key ID'),
  row('gitlab_token_leaked', 'critical', 'credential_exposure', String.raw`(?-i:glpat-[A-Za-z0-9_-]{20,})`, 'GitLab personal access token'),
  // Jailbreak patterns.
  row('jailbreak_dan', 'critical', 'injection', String.raw`\bDAN\s+mode\b|Do\s+Anything\s+Now`, 'DAN jailbreak attempt'),
  row('jailbreak_dev_mode', 'critical', 'injection', String.raw`\bdeveloper\s+mode\b${ANY}\benabled?\b`, 'developer mode jailbreak attempt'),
  row('hypothetical_bypass', 'high', 'injection', String.raw`hypothetical\s+scenario${ANY}(?:ignore|bypass|override)`, 'hypothetical scenario used to bypass restrictions'),
  row('educational_pretext', 'medium', 'injection', String.raw`for\s+educational\s+purposes?\s+only`, 'educational pretext'),
  row('remove_filters', 'critical', 'injection', String.raw`(?:respond|answer|reply)\s+without\s+${FILLER}(?:restrictions|limitations|filters|safety)`, 'instructs the reader to respond without safety filters'),
  row('fake_update', 'high', 'injection', String.raw`you\s+have\s+been\s+${FILLER}(?:updated|upgraded|patched)\s+to`, 'fake update announcement'),
  row('fake_policy', 'medium', 'injection', String.raw`new\s+${FILLER}policy|updated\s+${FILLER}guidelines|revised\s+${FILLER}instructions`, 'claims a new policy or guidelines'),
  // Context window exfiltration: instruction shapes only, and never the reader's own subagents.
  row(
    'context_exfil',
    'high',
    'exfiltration',
    String.raw`\b(?:include|output|print|send|share)\s+${NO_TRANSFER}${SHORT_FILLER}(?:conversation|chat\s+history|previous\s+messages)\b|\b(?:print|send|share|output|upload|transmit)\s+${NO_TRANSFER}${NOT_DELEGATE}(?:(?:\w{1,64}\s+){0,2}?${CONTEXT_SCOPE}(?:\w{1,64}\s+){0,2}?context\b|(?:\w{1,64}\s+){0,3}?context\b${CONTEXT_DEST}|${CONTEXT_DATIVE})`,
    'instructs the reader to output or share conversation history',
  ),
  row('send_to_url', 'high', 'exfiltration', String.raw`(?:send|post|upload|transmit)\s+${ANY}\s+(?:to|at)\s+https?://`, 'instructs the reader to send data to a URL'),
];

export const SKILL_THREAT_PATTERN_IDS: readonly string[] = SKILL_THREAT_PATTERNS.map((pattern) => pattern.id);
