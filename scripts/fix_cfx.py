import urllib.request
import json

req = urllib.request.Request(
    'http://localhost:3000/api/maintenance/fix-trades',
    data=b'{}',
    headers={'Content-Type': 'application/json'}
)
urllib.request.urlopen(req)
