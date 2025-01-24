import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { createWorker, createScheduler } from 'tesseract.js';
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

function App() {
  const [text, setText] = useState('');
  const [tableData, setTableData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedImage, setSelectedImage] = useState(null);
  const [crop, setCrop] = useState();
  const [mode, setMode] = useState('text'); // 'text' or 'table'
  const imageRef = useRef(null);

  function centerAspectCrop(mediaWidth, mediaHeight, aspect) {
    return centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 50,
        },
        aspect,
        mediaWidth,
        mediaHeight
      ),
      mediaWidth,
      mediaHeight
    );
  }

  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    setCrop(centerAspectCrop(width, height, 16 / 9));
  };

  const preprocessImage = (canvas) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Increase contrast and convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const newVal = avg > 128 ? 255 : 0; // Thresholding
      data[i] = data[i + 1] = data[i + 2] = newVal;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  const formatTableData = (data) => {
    if (!data || !data.lines || data.lines.length === 0) return null;

    // Group lines by their vertical position (with some tolerance)
    const tolerance = 10;
    const rows = [];
    let currentRow = [];
    let lastY = data.lines[0].bbox.y0;

    data.lines.forEach((line) => {
      if (Math.abs(line.bbox.y0 - lastY) > tolerance) {
        if (currentRow.length > 0) {
          rows.push(currentRow);
          currentRow = [];
        }
        lastY = line.bbox.y0;
      }
      currentRow.push(line);
    });
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    // Sort cells within each row by x position
    rows.forEach(row => {
      row.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    });

    return rows.map(row => row.map(cell => cell.text));
  };

  const processSelectedRegion = async () => {
    if (!crop || !imageRef.current) return;

    try {
      setIsProcessing(true);
      setText('');
      setTableData(null);

      // Create a canvas to extract the cropped region
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const scaleX = imageRef.current.naturalWidth / imageRef.current.width;
      const scaleY = imageRef.current.naturalHeight / imageRef.current.height;

      canvas.width = crop.width * scaleX;
      canvas.height = crop.height * scaleY;

      ctx.drawImage(
        imageRef.current,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        crop.width * scaleX,
        crop.height * scaleY
      );

      // Preprocess the image
      const processedCanvas = preprocessImage(canvas);
      
      // Convert canvas to blob
      const blob = await new Promise(resolve => processedCanvas.toBlob(resolve, 'image/jpeg'));
      
      const worker = await createWorker({
        logger: m => {
          if (m.status === 'recognizing text') {
            setProgress(parseInt(m.progress * 100));
          }
        }
      });

      await worker.loadLanguage('eng');
      await worker.initialize('eng');

      // Set specific parameters for better table recognition
      await worker.setParameters({
        tessedit_pageseg_mode: mode === 'table' ? '6' : '3', // 6 for uniform block of text, 3 for column detection
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?@#$%^&*()[]{}<>"\'/\\-_+=~ ',
      });

      const result = await worker.recognize(blob);
      
      if (mode === 'table') {
        const formattedTable = formatTableData(result.data);
        setTableData(formattedTable);
      } else {
        setText(result.data.text);
      }

      await worker.terminate();
    } catch (error) {
      console.error('Error processing image:', error);
      setText('Error processing image. Please try again.');
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles && acceptedFiles[0]) {
      const file = acceptedFiles[0];
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp']
    }
  });

  const renderTable = () => {
    if (!tableData) return null;

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="bg-white divide-y divide-gray-200">
            {tableData.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">Image Text Extractor</h1>
        
        {!selectedImage ? (
          <div 
            {...getRootProps()} 
            className={`p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'}`}
          >
            <input {...getInputProps()} />
            {isDragActive ? (
              <p className="text-lg">Drop the image here...</p>
            ) : (
              <p className="text-lg">Drag & drop an image here, or click to select one</p>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                aspect={undefined}
              >
                <img
                  ref={imageRef}
                  src={selectedImage}
                  onLoad={onImageLoad}
                  alt="Upload"
                  className="max-w-full"
                />
              </ReactCrop>
            </div>
            
            <div className="mt-4 flex gap-4 justify-center">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="px-4 py-2 border rounded"
              >
                <option value="text">Regular Text</option>
                <option value="table">Table/Grid</option>
              </select>
              <button
                onClick={processSelectedRegion}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                disabled={isProcessing}
              >
                Extract {mode === 'table' ? 'Table' : 'Text'} from Selected Region
              </button>
              <button
                onClick={() => {
                  setSelectedImage(null);
                  setText('');
                  setTableData(null);
                  setCrop(undefined);
                }}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                Choose Different Image
              </button>
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-center mt-2">Processing... {progress}%</p>
          </div>
        )}

        {(text || tableData) && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Extracted {mode === 'table' ? 'Table' : 'Text'}:</h2>
            <div className="bg-white p-6 rounded-lg shadow">
              {mode === 'table' ? renderTable() : (
                <pre className="whitespace-pre-wrap font-mono text-sm">{text}</pre>
              )}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(mode === 'table' ? 
                tableData.map(row => row.join('\t')).join('\n') : 
                text
              )}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Copy to Clipboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;