import os
import io
import uvicorn
import numpy as np
import nest_asyncio
from enum import Enum
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import cv2
from typing import List
from numpy import ndarray
from typing import List, Dict
from PIL import Image
import base64
from fastapi import Response
from detection import Detection

# Initialize Detection
detection = Detection(
    model_path='best.onnx', 
    classes=['damaged door', 'damaged window', 'damaged headlight', 'damaged mirror', 'dent', 'damaged hood', 'damaged bumper', 'damaged wind shield'] 
)

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

@app.post('/detection')
def post_detection(file: bytes = File(...)):
   image = Image.open(io.BytesIO(file)).convert("RGB")
   image = np.array(image)
   image = image[:,:,::-1].copy() # RGB to BGR
   # If we want to support webcam frame blob (which might come as multipart form data with 'file' field),
   # we might need to adjust. 
   # Actually the frontend sends 'file' in formData for webcam too.
   # But is it bytes or UploadFile?
   # The generic handler 'file: bytes = File(...)' works for both if we send it right.
   # However, frontend sends a Blob which behaves like a file.
   results = detection(image)
   return results

@app.post("/analyze")
async def analyze_car(files: List[UploadFile] = File(...)):
    results = {}
    
    # Process each file, assuming files are indexed 0, 1, 2... or use filename
    for i, file in enumerate(files):
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        image = np.array(image)
        image = image[:,:,::-1].copy() # RGB to BGR
        
        # Run detection
        det_result = detection(image)
        
        # Use filename or index as key
        key = f"Image {i+1}" 
        results[key] = det_result
        
    return results

@app.post("/analyze_video")
async def analyze_video(file: UploadFile = File(...)):
    try:
        # Create temp directory for videos
        os.makedirs("static/videos", exist_ok=True)
        
        # Use .webm for better browser compatibility (VP8 codec)
        base_name = os.path.splitext(file.filename)[0]
        output_filename = f"output_{base_name}.webm"
        output_video_path = f"static/videos/{output_filename}"
        
        input_video_path = f"static/videos/input_{file.filename}"
        
        with open(input_video_path, "wb") as buffer:
            buffer.write(await file.read())
            
        cap = cv2.VideoCapture(input_video_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open video file")
            
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        
        if width == 0 or height == 0:
             raise HTTPException(status_code=400, detail="Invalid video dimensions")

        # Define codec and create VideoWriter
        # VP80 (WebM) is widely supported by OpenCV and Browsers
        try:
            fourcc = cv2.VideoWriter_fourcc(*'vp80') 
        except:
            print("VP80 codec init failed")
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            output_filename = f"output_{base_name}.mp4"
            output_video_path = f"static/videos/{output_filename}"

        out = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))
        if not out.isOpened():
             # Try fallback to mp4v if vp80 failed to open writer (not just init)
             print("VideoWriter failed to open with VP80. Trying mp4v fallback.")
             fourcc = cv2.VideoWriter_fourcc(*'mp4v')
             output_filename = f"output_{base_name}.mp4"
             output_video_path = f"static/videos/{output_filename}"
             out = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))
             if not out.isOpened():
                 raise HTTPException(status_code=500, detail="Could not initialize VideoWriter")

        unique_damages = {} # {label: max_confidence}

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            # Run detection on frame
            try:
                # Detection class expects BGR image (it handles swapRB=True internally)
                results = detection(frame) 
                
                boxes = results['boxes']
                classes = results['classes']
                confidences = results['confidences']
                
                for i, box in enumerate(boxes):
                    x, y, w, h = box
                    label = classes[i]
                    conf = confidences[i]
                    
                    # Track unique damages
                    if label not in unique_damages or conf > unique_damages[label]:
                         unique_damages[label] = conf

                    # Draw rectangle
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                    
                    # Draw label: label + percentage
                    text = f"{label}: {conf:.0f}%"
                    
                    # Get text size
                    (text_width, text_height), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
                    
                    # Draw text background
                    cv2.rectangle(frame, (x, y - 20), (x + text_width, y), (0, 255, 0), -1)
                    
                    # Draw text
                    cv2.putText(frame, text, (x, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
                    
            except Exception as e:
                print(f"Frame processing error: {e}")
                pass
            
            out.write(frame)
            
        cap.release()
        out.release()
        
        # Format summary for frontend
        summary_list = [{"label": k, "score": float(v)} for k, v in unique_damages.items()]
        
        return {"video_url": f"/static/videos/{output_filename}", "damage_summary": summary_list}

    except Exception as e:
        print(f"Error processing video: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == '__main__':
    uvicorn.run("main:app", host="0.0.0.0", port=8080)

