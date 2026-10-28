FROM python:3.12-slim

ARG PYFA_REF=latest

ENV PYTHONUNBUFFERED=1 \
    PYFA_REF=${PYFA_REF} \
    PYFA_INSTALL_METADATA=/opt/pyfa-install.json \
    PYFA_ROOT=/opt/pyfa \
    PYTHONPATH=/opt/pyfa:/app

WORKDIR /app

COPY requirements.txt /app/requirements.txt
COPY scripts/install_pyfa.py /tmp/install_pyfa.py
RUN python /tmp/install_pyfa.py --ref "${PYFA_REF}" --root "${PYFA_ROOT}" --metadata "${PYFA_INSTALL_METADATA}"
RUN pip install --no-cache-dir -r /app/requirements.txt -r "${PYFA_ROOT}/requirements-headless.txt" \
    && pip check
RUN printf '%s\n' \
      'class Colour:' \
      '    def __init__(self, *args, **kwargs):' \
      '        self.args = args' \
      '' \
      'def GetTranslation(text):' \
      '    return text' \
      '' \
      'class CommandProcessor:' \
      '    def __init__(self, *args, **kwargs):' \
      '        self.Commands = []' \
      '    def Submit(self, command):' \
      '        self.Commands.append(command)' \
      '        return True' \
      '    def Undo(self):' \
      '        if self.Commands:' \
      '            self.Commands.pop()' \
      '        return True' \
      '    def ClearCommands(self):' \
      '        self.Commands.clear()' \
      '' \
      'def CallAfter(fn, *args, **kwargs):' \
      '    return fn(*args, **kwargs)' \
      > "${PYFA_ROOT}/wx.py" \
    && python "${PYFA_ROOT}/db_update.py"

COPY app.py /app/app.py
COPY pyfa_adapter /app/pyfa_adapter
COPY scripts /app/scripts
COPY tests /app/tests
COPY docs /app/docs
COPY README.md /app/README.md
COPY THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md

# Reject releases that cannot calculate a fit or list charges/scripts through our adapter.
RUN PYFA_SAVEDDATA_DB=sqlite:///:memory: python /app/scripts/smoke.py

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
