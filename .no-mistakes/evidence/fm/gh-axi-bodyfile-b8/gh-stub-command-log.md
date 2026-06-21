# gh stub command log

## gh ["pr","create","--title","E2E body-file PR","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["pr","edit","123","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["pr","review","123","--comment","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["pr","comment","123","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["pr","view","123","--json","state,mergedBy,mergedAt"]

## gh ["pr","merge","123","--squash","--delete-branch","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`.","--subject","Squash subject"]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["issue","create","--title","E2E body-file issue","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["issue","view","99","--json","number,title,state,url,id"]

## gh ["issue","edit","99","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["issue","view","99","--json","number,title,state,labels,assignees,id"]

## gh ["issue","comment","99","--body","# Body file E2E\n\n- dash-leading markdown survives\n- second bullet stays on its own line\n\n```ts\nconst fromBodyFile = true;\n```\n\nFinal paragraph with `inline code`."]

body:

````markdown
# Body file E2E

- dash-leading markdown survives
- second bullet stays on its own line

```ts
const fromBodyFile = true;
```

Final paragraph with `inline code`.
````

## gh ["issue","view","99","--json","comments"]

## gh ["release","create","v9.9.9-bodyfile","--notes","# Release notes E2E\n\n## Highlights\n\n- Notes came from --body-file\n- Existing release assets remain positional arguments","--draft","dist/app.zip"]

notes:

```markdown
# Release notes E2E

## Highlights

- Notes came from --body-file
- Existing release assets remain positional arguments
```

## gh ["release","edit","v9.9.9-bodyfile","--title","Retitled release","--notes","# Release notes E2E\n\n## Highlights\n\n- Notes came from --body-file\n- Existing release assets remain positional arguments"]

notes:

```markdown
# Release notes E2E

## Highlights

- Notes came from --body-file
- Existing release assets remain positional arguments
```

## gh ["pr","comment","123","--body","- dash-leading inline body\n- still inline"]

body:

```markdown
- dash-leading inline body
- still inline
```
