from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/')
def hello():
    return 'Hello, Demo for Codepipeline CDK Deployment created with Q Developer.'

@app.route('/health')
def health():
    """Health check endpoint for the load balancer target group."""
    return jsonify({"status": "healthy"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)