"""Face ID for the Truck app: local face recognition, computed in Python.

Nothing here talks to a cloud service. Faces are detected, aligned and turned
into embeddings on this machine, stored in `face-id/faces/`, and compared with a
dot product. See README.md for what that does and does not protect.
"""

__version__ = "1.0.0"
