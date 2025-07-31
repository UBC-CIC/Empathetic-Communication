# Python Package Management Guide

This project uses **Poetry** for Python package management to ensure consistent, reproducible builds across all environments.

## Why Poetry?

- **Dependency Resolution**: Automatically resolves and locks dependency versions
- **Reproducible Builds**: `poetry.lock` ensures identical dependencies across environments
- **Simplified Management**: Single `pyproject.toml` file for all project metadata
- **Virtual Environment Management**: Automatic virtual environment creation and management
- **No More Deployment Issues**: Eliminates "works on my machine" problems

## Complete Setup Guide (For New Team Members)

### Step 1: Install Poetry

**Windows:**
```bash
# Option 1: Using py command (recommended for Windows)
curl -sSL https://install.python-poetry.org | py

# Option 2: Using python command
curl -sSL https://install.python-poetry.org | python
```

**macOS/Linux:**
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

**Windows Python Alias Setup (if needed):**
- Go to Settings → Apps → App execution aliases
- Turn OFF Python and Python3 aliases if they cause conflicts

### Step 2: Install Export Plugin
```bash
poetry self add poetry-plugin-export
```

### Step 3: Verify Installation
```bash
poetry --version
```

### Step 4: Clone Project
```bash
git clone https://github.com/UBC-CIC/Empathetic-Communication.git
cd Empathetic-Communication
```

### Step 5: Setup for Development (Optional)
**Only needed if you want to develop/test locally:**
```bash
# Install service dependencies for local development
cd cdk/data_ingestion
poetry install

cd ../text_generation
poetry install
```

**Note:** On Windows, you may see PyMuPDF build errors during `poetry install`. This is normal and can be ignored - PyMuPDF builds correctly in Docker during deployment.

### Step 6: Install CDK Dependencies
```bash
cd cdk
npm install
```

### Step 7: Deploy
**After following the deployment guide, this is all you need for deployment:**
```bash
cdk deploy --all --parameters EC-Dev-Amplify:githubRepoName=Empathetic-Communication --context StackPrefix=EC-Dev --profile ec-account --require-approval never
```

**That is all you need to do to deploy the application.** Poetry handles everything automatically during Docker builds.

## Quick Start (Minimum Steps)

For new team members who just want to deploy:

1. Install Poetry: `curl -sSL https://install.python-poetry.org | py` (Windows)
2. Install export plugin: `poetry self add poetry-plugin-export`
3. Clone repo: `git clone https://github.com/UBC-CIC/Empathetic-Communication.git`
4. Install CDK dependencies: `cd cdk && npm install`
5. Follow the deployment guide
6. Deploy: `cdk deploy --all --parameters EC-Dev-Amplify:githubRepoName=Empathetic-Communication --context StackPrefix=EC-Dev --profile ec-account --require-approval never`

**No need to run `poetry install` anywhere - Docker handles Python dependencies automatically**

## Project Structure

```
├── pyproject.toml          # Root project dependencies (shared)
├── poetry.lock            # Root lock file
├── cdk/
│   ├── data_ingestion/
│   │   ├── pyproject.toml  # Data ingestion service dependencies
│   │   ├── poetry.lock     # Service-specific lock file
│   │   └── Dockerfile      # Uses Poetry for dependency installation
│   └── text_generation/
│       ├── pyproject.toml  # Text generation service dependencies
│       ├── poetry.lock     # Service-specific lock file
│       └── Dockerfile      # Uses Poetry for dependency installation
```

## Managing Dependencies

### Adding Dependencies
```bash
# Add to specific service
cd cdk/data_ingestion
poetry add package-name

# Add development dependency
poetry add --group dev package-name
```

### Updating Dependencies
```bash
# Update all dependencies
poetry update

# Update specific package
poetry update package-name

# Update lock file only
poetry lock
```

### Removing Dependencies
```bash
poetry remove package-name
```

## Docker Integration

Our Dockerfiles use Poetry to install dependencies:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Install system dependencies
RUN yum -y install postgresql-devel gcc gcc-c++ libpq make

# Install Poetry
RUN pip install poetry

# Copy Poetry files
COPY pyproject.toml poetry.lock* ${LAMBDA_TASK_ROOT}

# Configure Poetry and install dependencies
WORKDIR ${LAMBDA_TASK_ROOT}
RUN poetry config virtualenvs.create false && \
    poetry install --no-root

# Copy source code
COPY src/ ${LAMBDA_TASK_ROOT}

CMD [ "main.handler" ]
```

## Configuration Files

### pyproject.toml Structure
```toml
[tool.poetry]
name = "service-name"
version = "0.1.0"
description = "Service description"

[tool.poetry.dependencies]
python = "^3.11"
boto3 = "*"
langchain = "*"
# Use "*" for latest compatible version
# Use "1.24.10" for exact version when needed

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

### Key Principles
1. **Use `"*"` for most dependencies** - allows Poetry to resolve the best compatible versions
2. **Pin specific versions only when necessary** - for packages with known compatibility issues
3. **Always commit poetry.lock** - ensures reproducible builds

## File Management After Poetry Implementation

### Files That Can Be Removed:
- **Old requirements.txt files** - Kept as backup, but Poetry is now primary

### Critical Files:
- **`pyproject.toml`** - Primary dependency definition
- **`poetry.lock`** - Locked versions (NEVER delete - ensures reproducible builds)
- **`Dockerfile`** - Now uses Poetry for dependency installation

### What Happens During Deployment:
1. CDK builds Docker images
2. Docker installs Poetry
3. Poetry reads `pyproject.toml` and `poetry.lock`
4. Poetry installs exact dependency versions
5. Lambda functions get consistent dependencies

## Troubleshooting

### Common Issues

1. **Poetry command not found**
   ```bash
   # Add Poetry to PATH or restart terminal
   # Windows: Add %APPDATA%\Python\Scripts to PATH
   # macOS/Linux: Add ~/.local/bin to PATH
   ```

2. **Dependency conflicts**
   ```bash
   # Clear cache and reinstall
   poetry cache clear pypi --all
   poetry install
   ```

3. **Docker build fails**
   ```bash
   # Ensure poetry.lock exists
   poetry lock
   
   # Rebuild without cache
   docker build --no-cache -t service-name .
   ```

4. **Virtual environment issues**
   ```bash
   # Remove and recreate environment
   poetry env remove python
   poetry install
   ```

### If Deployment Fails:
1. Check `poetry.lock` exists in service directories
2. Verify `pyproject.toml` has correct dependencies
3. Run `poetry lock` to regenerate lock file if needed
4. Check Docker build logs for specific errors

### Best Practices
1. **Always run `poetry lock` after changing dependencies**
2. **Commit both `pyproject.toml` and `poetry.lock`**
3. **Keep service dependencies isolated in separate directories**
4. **Test Docker builds locally before deployment**

## Support

For issues with package management:

1. Check this documentation
2. Review Poetry official docs: https://python-poetry.org/docs/
3. Check service-specific `pyproject.toml` files
4. Verify Docker build logs for dependency installation issues
5. Ensure `poetry.lock` files are committed to git