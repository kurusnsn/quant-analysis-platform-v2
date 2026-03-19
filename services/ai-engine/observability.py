import os
import threading
from opentelemetry import trace, metrics
from opentelemetry.metrics import Observation
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter

otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
service_name = os.getenv("OTEL_SERVICE_NAME", "quant-platform-ai-engine")
environment = os.getenv("OTEL_ENVIRONMENT", os.getenv("ASPNETCORE_ENVIRONMENT", "development"))

resource = Resource.create({
    "service.name": service_name,
    "service.namespace": "quant-platform",
    "deployment.environment": environment
})

trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=otel_endpoint, insecure=True))
)
trace.set_tracer_provider(trace_provider)

metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(endpoint=otel_endpoint, insecure=True)
)
metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[metric_reader]))

tracer = trace.get_tracer("quant-platform.ai-engine")
meter = metrics.get_meter("quant-platform.ai-engine")

request_duration_ms = meter.create_histogram("quant-platform.request.duration.ms", unit="ms")
external_call_duration_ms = meter.create_histogram("quant-platform.external.duration.ms", unit="ms")
queue_wait_duration_ms = meter.create_histogram("quant-platform.queue.wait.ms", unit="ms")

request_count = meter.create_counter("quant-platform.request.count")
error_count = meter.create_counter("quant-platform.error.count")
background_job_count = meter.create_counter("quant-platform.background.job.count")

_active_requests = 0
_event_loop_lag_ms = 0.0
_lock = threading.Lock()


def inc_active_requests() -> None:
    global _active_requests
    with _lock:
        _active_requests += 1


def dec_active_requests() -> None:
    global _active_requests
    with _lock:
        _active_requests = max(0, _active_requests - 1)


def set_event_loop_lag_ms(value: float) -> None:
    global _event_loop_lag_ms
    with _lock:
        _event_loop_lag_ms = value


def _observe_event_loop_lag(_options=None):
    with _lock:
        value = _event_loop_lag_ms
    return [Observation(value)]


def _observe_worker_utilization(_options=None):
    worker_count = int(os.getenv("UVICORN_WORKERS", "1")) or 1
    with _lock:
        active = _active_requests
    utilization = min(1.0, active / worker_count)
    return [Observation(utilization)]


def _observe_active_requests(_options=None):
    with _lock:
        active = _active_requests
    return [Observation(active)]


# opentelemetry-sdk expects an iterable of callbacks.
meter.create_observable_gauge("quant-platform.event_loop.lag.ms", callbacks=[_observe_event_loop_lag])
meter.create_observable_gauge("quant-platform.worker.utilization", callbacks=[_observe_worker_utilization])
meter.create_observable_gauge("quant-platform.requests.in_flight", callbacks=[_observe_active_requests])


def record_external_call(duration_ms: float, service: str, operation: str) -> None:
    external_call_duration_ms.record(
        duration_ms,
        {
            "peer.service": service,
            "external.operation": operation
        }
    )
