"""Performance changes must preserve every input/output frame and cancellation."""
import sys
from pathlib import Path
import threading
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from tracknet_v3 import prefetch_windows, V3Engine

class PerformanceTests(unittest.TestCase):
    def test_prefetch_order_and_errors(self):
        def frames():
            yield 1
            yield 2
            raise ValueError('decode failed')
        with prefetch_windows(frames()) as stream:
            self.assertEqual(next(stream), 1)
            self.assertEqual(next(stream), 2)
            with self.assertRaisesRegex(ValueError, 'decode failed'):
                next(stream)

    def test_prefetch_stops_full_producer_and_closes_capture(self):
        closed = threading.Event()
        def frames():
            try:
                yield from range(1000)
            finally:
                closed.set()
        with prefetch_windows(frames(), 1) as stream:
            self.assertEqual(next(stream), 0)
        self.assertTrue(closed.is_set())
        self.assertFalse(any(t.name == 'tracknet-decode' for t in threading.enumerate()))

    def test_evaluation_modes_reuse_models_without_mutating_previous_job(self):
        engine = object.__new__(V3Engine)
        engine.backend = 'openvino'
        engine.requested_device = 'CPU'
        engine.intra_threads = 8
        engine.repair = object()
        engine.track = object()
        engine.seq_len = 8
        engine.eval_mode = 'weight'
        engine.stride = 1
        engine.inpaint = True
        settings = dict(backend='openvino', device='CPU', intraThreads=8, evalMode='nonoverlap', inpaint=False)
        variant = engine.with_settings(settings)
        self.assertIs(variant.track, engine.track)
        self.assertEqual((variant.stride, variant.inpaint), (8, False))
        self.assertEqual((engine.stride, engine.inpaint), (1, True))
        self.assertFalse(engine.can_reuse_models({**settings, 'device': 'GPU'}))
        self.assertFalse(engine.can_reuse_models({**settings, 'intraThreads': 2}))
        engine.repair = None
        self.assertFalse(engine.can_reuse_models({**settings, 'inpaint': True}))

if __name__ == '__main__':
    unittest.main()
