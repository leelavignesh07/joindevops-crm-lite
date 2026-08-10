# GitHub Actions workflow templates

`ci.yml.template` and `deploy.yml.template` are ready-to-use GitHub Actions
workflows (CI on every PR, auto-deploy to EC2 on push to `main` — see
`DEPLOYMENT.md` section 9). They live here instead of `.github/workflows/`
because creating/updating files under that path requires a GitHub token with
the `workflow` OAuth scope, which the token used to push this repo didn't
have.

To enable them:

```bash
mkdir -p .github/workflows
cp github-workflow-templates/ci.yml.template .github/workflows/ci.yml
cp github-workflow-templates/deploy.yml.template .github/workflows/deploy.yml
git add .github/workflows
git commit -m "Add CI and deploy GitHub Actions workflows"
git push
```

(Use a Personal Access Token with the `workflow` scope, or push from the
GitHub web UI / a git client already authorized for that scope.) Then add the
`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, and `EC2_APP_DIR` repo secrets
described in `DEPLOYMENT.md` before the deploy workflow will run.
