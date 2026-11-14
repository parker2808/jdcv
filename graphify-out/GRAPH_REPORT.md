# Graph Report - chore-bootstrap  (2026-11-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 121 nodes · 129 edges · 15 communities (11 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `73910a65`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 10 edges
2. `with` - 7 edges
3. `scripts` - 7 edges
4. `steps` - 6 edges
5. `hooks` - 6 edges
6. `steps` - 4 edges
7. `steps` - 4 edges
8. `jobs` - 4 edges
9. `build` - 4 edges
10. `gitleaks` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (15 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.10
Nodes (24): runs-on, steps, timeout-minutes, GITHUB_TOKEN, runs-on, steps, timeout-minutes, jobs (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (16): devDependencies, eslint@^9.25.1, @eslint/js@^9.25.1, prettier@^3.5.3, @types/node@^22.15.3, typescript@^5.8.3, typescript-eslint@^8.31.0, name (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (10): concurrency, cancel-in-progress, group, name, on, pull_request, push, permissions (+2 more)

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.31
Nodes (4): git(), main(), git(), main()

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (8): main, name, private, scripts, build, type, types, version

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (8): entry, id, language, name, pass_filenames, repos, hooks, repo

### Community 7 - "Community 7"
Cohesion: 0.29
Nodes (7): scripts, build, check, format:check, lint, test, typecheck

### Community 8 - "Community 8"
Cohesion: 0.40
Nodes (3): vitest@^2.1.9, formatStudyPackTitle(), vitest

### Community 9 - "Community 9"
Cohesion: 0.40
Nodes (4): exclude, extends, include, ../../tsconfig.base.json

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (3): engines, node, pnpm

## Knowledge Gaps
- **1 isolated node(s):** `../../tsconfig.base.json`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 69 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jobs` connect `Community 0` to `Community 2`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `../../tsconfig.base.json` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.10144927536231885 - nodes in this community are weakly interconnected._
- **Why does `scripts` connect `Community 7` to `Community 1`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
