{{/* Chart name, overridable. */}}
{{- define "wi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "wi.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "wi.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "wi.labels" -}}
app.kubernetes.io/name: {{ include "wi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
  The image tag is required rather than defaulted to appVersion or `latest`.
  "Roll back to the previous image" is the entire recovery plan in
  docs/DEVOPS/08-ROLLBACK.md, and a moving tag makes that sentence meaningless.
*/}}
{{- define "wi.image" -}}
{{- $tag := .Values.image.tag | default "" -}}
{{- if not $tag -}}
{{- fail "image.tag must be set to an immutable tag or digest. See docs/DEVOPS/08-ROLLBACK.md." -}}
{{- end -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository $tag -}}
{{- end -}}

{{/*
  Pod-level hardening applied to every workload in this chart.
  docs/DEVOPS/02 § Container Security Principles.
*/}}
{{- define "wi.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "wi.containerSecurityContext" -}}
allowPrivilegeEscalation: false
privileged: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* Environment shared by the API and every worker pool. */}}
{{- define "wi.env" -}}
- name: NODE_ENV
  value: {{ .Values.config.nodeEnv | quote }}
- name: BODY_LIMIT
  value: {{ .Values.config.bodyLimit | quote }}
- name: SHUTDOWN_TIMEOUT_MS
  value: {{ .Values.config.shutdownTimeoutMs | quote }}
- name: APP_ORIGIN
  value: {{ printf "https://%s" .Values.hosts.app | quote }}
- name: PUBLIC_INVITE_ORIGIN
  value: {{ printf "https://%s" .Values.hosts.publicInvite | quote }}
- name: ADMIN_ORIGIN
  value: {{ printf "https://%s" .Values.hosts.admin | quote }}
# Secrets come from a Secret that already exists in the namespace, never from values.
# envFrom rather than individual keys, so adding one is a secret-store change and not
# a chart change (P0-18).
{{- end -}}
