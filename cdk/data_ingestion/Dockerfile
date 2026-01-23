FROM public.ecr.aws/lambda/python:3.12

# Install system dependencies
RUN dnf -y install postgresql-devel gcc gcc-c++ libpq make

# Install Poetry
RUN pip install poetry

# Copy Poetry files
COPY pyproject.toml poetry.lock* ${LAMBDA_TASK_ROOT}

# Configure Poetry and install dependencies directly
WORKDIR ${LAMBDA_TASK_ROOT}
RUN poetry config virtualenvs.create false && \
    poetry install --no-root

# Copy the source code
COPY src/ ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler
CMD [ "main.handler" ]