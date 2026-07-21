FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 JUDGE_QUEUE_DIR=/queue
WORKDIR /opt/judge
COPY worker.py /opt/judge/worker.py
RUN addgroup --system kidtype && mkdir -p /queue/incoming /queue/outgoing /tmp && chgrp -R kidtype /queue && chmod 770 /queue /queue/incoming /queue/outgoing
ENTRYPOINT ["python", "/opt/judge/worker.py"]
