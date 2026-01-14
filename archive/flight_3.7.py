""" 
Changes needed:
    1) Run on startup
    2) Collision lights on dusk to dawn only and for 2 minutes post launch
    3) Automatic nohup
    4) Add APRS Transmit 
    5) Add sx1278 listening function
    6) Spend 95% of time listening for radio transmissions
    
    x) Get the DHT-22 working
    x) Get the Baro working
    x) Fold in code to set the airborne mode to Airborne <2G at the beginning

sudo pip install LoRaRF --break-system-packages

Path to python interpreter: /usr/bin/python3
Path to file: /home/11a/flight_3.4.py

"""

import asyncio
import csv
from datetime import datetime, date
import gpiozero
from gpiozero import Servo
from gpiozero.pins.pigpio import PiGPIOFactory  #To reduce servo jitter, use the pigpio pin driver rather than the default RPi.GPIO driver 
import os
import re

from ina219 import INA219
from ina219 import DeviceRangeError
from LoRaRF import SX127x
from pigpio_dht import DHT22

import pynmea2
import serial
from shapely.geometry import Polygon, Point
import subprocess
import sys
import time


#-------------------- INPUT REQUIRED --------------------
# CONFIGURE NEO6M with the computer if the code wont do it

testing_mode = False         # SET TO FALSE BEFORE FLIGHT!!! <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
flight_time_limit_hours = 2 # Hours of flight before termination
record_interval = 10        # Seconds between recording flight data
display_interval = 10       # Seconds between data being displayed to the screen while in TEST mode
sensor_interval = 20        # Seconds between sensor readings
heat_time = 20              # Seconds Nichrome wire is heating 
airborne_delta = 20        # Meters above launch site elevation to trigger airborne mode

update_interval = 10         # Minutes between LoRa update transmissions
msg_iterations = 3          # Total number of times the message will be sent per update burst
msg_interval = 5            # Number of seconds between the burst messages (>=5 required)


"""
test_area = "California--Skylark Park (Elevation 32m)"
bound_1 = Point(37.06231877848365, -120.34638618916614) #SE Corner
bound_2 = Point(37.49052266840307, -120.69282482882616) #NE Corner
bound_3 = Point(37.47952653379495, -121.10970599188374) #NW Corner
bound_4 = Point(37.01622957747398, -120.91339076274305) #SW Corner
"""

test_area = "Colorado OpArea 2__November Launch"
bound_1 = Point(41.01, -102.9) #NE Corner  
bound_2 = Point(37.01, -102.9) #SE Corner  
bound_3 = Point(37.01, -109.05) #SW Corner
bound_4 = Point(41.01, -109.05) #NW Corner
# Falcon Regional Dog Park: 38.990173, -104.567648
"""

test_area = "Okaloosa Island"
bound_1 = Point(30.4, -86.59) #NE Corner  
bound_2 = Point(30.39, -86.59) #SE Corner  
bound_3 = Point(30.39, -86.6) #SW Corner
bound_4 = Point(30.4, -86.6) #NW Corner
# Four Points: 38.3936, -86.5952
"""

#-------------------- Seconds conversion --------------------
flight_time_limit = 60 * 60 * flight_time_limit_hours


#-------------------- FORMATTING & ID --------------------
(RED, ORANGE, YELLOW, GREEN, CYAN, BLUE, MAGENTA, RESET) = ('\033[91m', '\033[38;5;208m', '\033[93m', '\033[92m', '\033[96m', '\033[94m', '\033[95m', '\033[0m')
print(f'\n{CYAN}{"Initializing..."}{RESET}\n')
balloon_id = "none"


def get_computer_type():
    """
    - This code will extract the ID information from the computer to determine the balloon ID.
    - This information is useful in determining the hardware configuration so that this code will not fail or run unnecessary functions
    """
    global balloon_id
    username = os.getlogin()
    
    match = re.match(r"([^@]+)", username)      # Extract part before '@' if it exists
    if match:
        balloon_id = match.group(1)             # Get the part before '@'
        last_letter = username[-1].lower()      # Get and lowercase the last letter
        computer_types = {
            "a": "A",
            "b": "B",
            "c": "C"
        }
        if last_letter in computer_types:
            return computer_types[last_letter]
    return "Unknown"  # Username not found or doesn't match, return "Unknown"
computer_type = get_computer_type()


#-------------------- I2C SETUP --------------------
if computer_type == "A":
    """
    The I2C is used for communicating with the INA219 Voltage and Current monitor. 
    Only the A computers are configured with this.
    The INA-219 is only useful for testing and will be removed in operational variants.
    """
    SHUNT_OHMS = 0.1
    MAX_EXPECTED_AMPS = 0.4
    I2C_BUS = 1

    ina = INA219(SHUNT_OHMS, MAX_EXPECTED_AMPS, address=0x40, busnum=I2C_BUS)
    ina.configure(ina.RANGE_16V, ina.GAIN_1_40MV, ina.ADC_128SAMP, ina.ADC_128SAMP)
else:
    ina = None


#-------------------- SERIAL PORT SETUP --------------------
def find_available_port():   
    """
    The Serial Port is being used to communicate with the GPS unit. This code will determine the serial port in use,
    and will set it up for communication with the NEO-6M GPS unit. If you get a port error, check the 'sudo raspi-config'
    CLI function to ensure login port over serial is disabled and serial port hardware is enabled. If the serial port is still 
    showing an error, you might have a bad GPS unit (this is the most common error and simply changing the GPS unit clears it out).
    """ 
    try:
        ports = ['/dev/ttyS0', '/dev/ttyAMA0']  # List of ports to check
        for port in ports:
            try:
                with serial.Serial(port, baudrate=9600, timeout=1) as ser:
                    if ser.readline():  # Check if we can read from the port
                        return port  # Should return the successful port here
            except Exception as e:
                pass  # Ignore the exception and try the next port
            time.sleep(1)  # Wait before trying the next port

        raise RuntimeError("No available serial ports found.")  # Raise if none found
    except RuntimeError as e:
        print(f'{RED}{"!!! Serial port error:":<25}{RESET}{e}')  # Print error message
        sys.exit()  # Exit the program

port_used = find_available_port()  # Call the function to find and return the port
ser = serial.Serial(port_used, baudrate=9600, timeout=0.5)  # Open the port with specified settings
dataout = pynmea2.NMEAStreamReader()  # Initialize NMEA stream reader
newdata = ser.readline()  # Read data from the port


#-------------------- GPIO SETUP --------------------
def initialize_gpio():
    """
    - The GPI pins control the Relay switches and are used to communicate with other devices. This code initializes the GPIO pin library.
    - Sensors like the DHT-22 (temp, pressure, humidity) will communicate via GPIO. The DHT-22 is only on the A Computer currently.
    """
    command = "sudo pigpiod"    # Is this even required to run? <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
    try:
        result = subprocess.run(command, shell=True, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.stderr:
            error_message = result.stderr.strip()
            status_message = f"{RED}{'Initialization failed:'}{error_message}{RESET}"
        else:
            status_message = f"{GREEN}{'Initialized'}{RESET}"
            error_message = ''  # No error message
    except subprocess.CalledProcessError as e:
        error_message = e.stderr.strip()
        status_message = f"{RED}{'Initialization failed:'}{error_message}{RESET}"
    print(f"{MAGENTA}{'GPIO:':<20}{status_message}\n")
initialize_gpio()

relay_on = 1  # The HiLetgo uses standard 0 = Off and 1 = On, but the ELEGOO relay uses 1 OFF and 0 on
relay_off = 0
heat_element = gpiozero.PWMOutputDevice(26)
heat_element.value = relay_off
strobe_led = gpiozero.PWMOutputDevice(5)
strobe_led.value = relay_off 
status_led = gpiozero.PWMOutputDevice(6)
status_led.value = relay_off  
if computer_type == "A":
    sensor_dht22 = DHT22(16) 
if computer_type == "A" or "C":
    servo = Servo(4, pin_factory=PiGPIOFactory()) # Pin 7
    servo_open = 1
    servo_close = -1
    servo.value = servo_close


#-------------------- INITIALIZE GLOBAL VARIABLES --------------------
if True:
    gps_lat = 0.0
    gps_lon = 0.0
    gps_spd = 0
    gps_trk = 0
    gps_day = '00'
    gps_alt = 0.0
    gps_sat = '0'
    gps_time = ''
    gps_valid = False
    map_link = "*** No GPS data ***"

    airborne = False
    terminate = False
    intact = True 
    trigger = ''

    launch_alt = 0
    launch_alt_set = False
    preflight_start = asyncio.get_event_loop().time()
    max_alt = 0
    min_alt = 0
    landed = False
    climbing = False

    #The Polygon is used to form the geographic boundary outside of which the balloon will terminate
    polygon = Polygon([bound_1, bound_2, bound_3, bound_4]) 
    contained = False       # The contained variable reflects the position of the balloon relative to the polygon

    int_temp = 0.0
    int_humid = 0.0
    voltage = 0.0
    current = 0.0
    power = 0.0
    charge = 0.0
    baro_alt = 0

    start_time = None
    flight_time = 0
    record_time = '' 

    msg_sent = ''
    object_report = 'None'
    tx_counter = 0
    send_update = True
    tx_time = 0
    tx_rate = 0

#-------------------- NEO-6M Initialization --------------------
def neo6m_configure(): 
    """
    - The NEO-6M GPS unit defaults to a "normal" mode whereby it does not record altitude above 12km. 
    - We are working code to change this mode to "Airborne <2G" mode, whereby it will record altitude up to 60km, but this code is
    not yeat reliably operational. Once it is functtional, it will go here.
    """
    print(f'{YELLOW}{">>>>>>>>>> !!! CONFIRM NEO-6M is configured for Airborne <2G !!! <<<<<<<<<<"}{RESET}')
    # Put actual code here to send the config message
    
    
#-------------------- SX1278 Initialization --------------------
LoRa = SX127x()
if computer_type == "A" or "C":
    """
    - The SX1278 LoRa transceiver is how we broadcast messages over 433 MHz to the ground station(s). 
    - This code will setup the transceiver for operation with the designated parameters. 
    - LoRa APRS operates at 433.775 MHz with 125 MHz bandwidth, 12 spreading factor, and 5 code rate
    - Ensure the base station is operating with the same settings
    - The B computers are not equipped with transmitters
    """
    # SPI Port Configuration: bus id 0 and cs id 1 and speed 7.8 Mhz
    LoRa.setSpi(0, 0, 7800000)  
    # I/O Pins Configuration: set RESET->22, BUSY->23, DIO1->26, TXEN->5, RXEN->25
    LoRa.setPins(22, 23)  
    LoRa.begin()
    # Modem Configuration 
    LoRa.setTxPower(17, LoRa.TX_POWER_PA_BOOST)     # Set TX power +17 dBm using PA boost pin
    LoRa.setRxGain(LoRa.RX_GAIN_POWER_SAVING, LoRa.RX_GAIN_AUTO)    # AGC on, Power saving gain
    LoRa.setFrequency(433775000)                    # Set frequency to 433.775 Mhz, the LoRa APRS frequency, or 433.5
    # Receiver must have same SF and BW setting with transmitter to be able to receive LoRa packet
    LoRa.setSpreadingFactor(12)     # 12 (max) Prioritizes long-range communication and can tolerate a slower data rate
    LoRa.setBandwidth(125000)       # 125 kHz: most commonly used bandwidth for LoRa and is ideal for long-range communication
    LoRa.setCodeRate(5)   # 8 is best for very noisy or long-range applications where maximum reliability is necessary    
    # Packet configuration 
    LoRa.setLoRaPacket(LoRa.HEADER_EXPLICIT, 12, 15, True, False)   # set explicit header mode, preamble length 12, payload length 15, CRC on and no invert IQ operation
    # Set syncronize word for public network (0x3444)
    LoRa.setSyncWord(0x3444)    # Set syncronize word for public network (0x3444)

    
#-------------------- Preflight Configuration Information Printout --------------------    
print(f"{MAGENTA}{'-' * 100}{RESET}" '\n'
    f"{CYAN}{'Flight telemetry configuration':<50}{RESET}" '\n'
    f"{RESET}{'Serial port:':<20}{RESET}{port_used:<30}{'Time:':<20}{RESET}{datetime.now().strftime('%H%M on %d %b')}" '\n'
    f"{RESET}{'Balloon ID:':<20}{RESET}{balloon_id:<30}{'Computer:':<20}{RESET}{computer_type}" '\n'
    f"{RESET}{'Test area:':<20}{RESET}{test_area}" '\n'
    f"{RESET}{'Flight limit (s):':<20}{RESET}{flight_time_limit}" '\n' '\n'
   
    f"{CYAN}{'Radio Config':<50}{'Station Info':<20}{RESET}" '\n'
    f"{'Transmit frequency:':<20}{YELLOW}{LoRa._frequency / 1000000:.3f}{' MHz':<23}{RESET}"
      f"{'Station ID:':<20}{YELLOW}{'NONE'}{RESET}" '\n'
    f"{'Bandwidth:':<20}{YELLOW}{LoRa._bw / 1000000:>7.3f}{' MHz':<23}{RESET}"
      f"{'Station config:':<20}{YELLOW}{'Balloon'}{RESET}" '\n'
    f"{'Spreading factor:':<20}{YELLOW}{LoRa._sf:<30}{RESET}" '\n'
    f"{'Coding rate:':<20}{YELLOW}{LoRa._cr:<30}{RESET}" '\n'
    f"{MAGENTA}{'-' * 100}{RESET}" '\n'
)


#-------------------- TROUBLESHOOTING --------------------
def print_mark(mark):  # TROUBLESHOOTING
    global timestamp
    timestamp = datetime.now().strftime("%H:%M:%S") 
    print(MAGENTA, f"Mark {mark}:", timestamp, RESET, '\n')


#-------------------- TELEMETRY --------------------
async def gps():  #~~~~~ TASK 1 ~~~~~
    """
    - The gps() Function will read the messages coming off the GPS unit, which are formatted according the NMEA standards.
    - This code uses a library, 'pynmea2', to extract the relevant information from the NMEA messages.
    - It will format the extracted data for use in the code.
    - The asyncio sleep should be the shortest sleep in the code to avoid passing bad data to other functions
    """
    global gps_valid, gps_lat, gps_lon, gps_spd, gps_trk, gps_time, gps_day, map_link, gps_alt, gps_sat
    last_error_time = 0 
    while True:
        try:
            newdata = ser.readline()
            if newdata[0:6] == b"$GPRMC":
                rmcmsg = pynmea2.parse(newdata.decode('utf-8'))
                gps_valid = True if rmcmsg.status == "A" else False
                gps_lat = float("{:.5f}".format(rmcmsg.latitude))
                gps_lon = float("{:.5f}".format(rmcmsg.longitude))
                gps_spd = float("{:.1f}".format(rmcmsg.spd_over_grnd)) if rmcmsg.spd_over_grnd is not None else 0.0
                gps_trk = float("{:.1f}".format(rmcmsg.true_course)) if rmcmsg.true_course is not None else 0.0
                gps_time = rmcmsg.timestamp.strftime('%H:%M:%S')
                #gps_day = rmcmsg.timestamp.strftime('%d')  # added to get the date for use in the APRS message ***This is not working so we are using the computer day, which will disagree at times
                gps_day = str(date.today().day)
                map_link = f'{gps_lat},{gps_lon}'
            if newdata[0:6] == b"$GPGGA":
                ggamsg = pynmea2.parse(newdata.decode('utf-8'))
                gps_alt = float("{:.1f}".format(ggamsg.altitude))
                gps_sat = ggamsg.num_sats
            await asyncio.sleep(.01)  # This must be the smallest sleep in all the code
        except Exception as e:
            current_time = time.time()
            if current_time - last_error_time >= 5:
                print(f"\n{RED}{'GPS data error:':<25}{RESET}{e}\n")
                last_error_time = current_time
 
        
async def record():  #~~~~~ TASK 2 ~~~~~
    """
    - The record() Function creates a CSV file and records data every x seconds for recover after the flight. 
    - This csv is saved to the same location where the code resides.
    - Ensure you DELETE this file once downloaded, as well as any nohup files to save space on the SD card
    """ 
    global record_interval, record_time
    filetime = datetime.now().strftime('%d%b_%H%M')  # Format (DDMon_HHMM)
    filename = f"{balloon_id}_flight_data_{filetime}.csv"
    print(f'{MAGENTA}{"Data record created:":<25}{RESET}{filename}\n')
    while True:
        try:        
            with open(filename, mode='a', newline='') as file:  # Open the CSV file in append mode
                csv_writer = csv.writer(file)  # Create a CSV writer object
                if file.tell() == 0:  # Write the headers if the file is empty
                    csv_writer.writerow(["CPU Time", "GPS Time", "Latitude", "Longitude", "Altitude (M)", 
                                         "Track", "Speed (kts)", "Flt mode", "Elapsed (s)", "Contained", 
                                         "Terminate", "Intact", "Trigger", "Int temp", "Int humid", 
                                         "Voltage (V)", "Current (mA)", "Power (mW)",
                                         "Launch Alt", "Max Alt", "Min Alt", "Climbing", "Landed"
                    ])
                record_time = datetime.now().strftime("%H:%M:%S")
                csv_writer.writerow([record_time, gps_time, gps_lat, gps_lon, gps_alt, 
                                     gps_trk, gps_spd, airborne, flight_time, contained, 
                                     terminate, intact, trigger, int_temp, int_humid, 
                                     voltage, current, power,
                                     launch_alt, max_alt, min_alt, climbing, landed
                ]) 
                # print(f'\n{MAGENTA}{"Data written to CSV:":<25}{RESET}Time {record_time} at {gps_alt}m MSL located: {gps_lat} / {gps_lon} traveling {gps_trk}deg at {gps_spd}kts\n')
            await asyncio.sleep(record_interval)   # Wait for x seconds before writing to the CSV file again
        except Exception as e:
            print(f"\n{RED}{'CSV write error:':<25}{RESET}{e}\n")
 
               
async def display():  #~~~~~ TASK 3 ~~~~~
    """
    - The display() code will display data to the CLI every x number of seconds while in Test mode (testing-mode variable is True).
    - Before flight, the testing_mode variable should be set to False, to avoid writing data to the CLI and creating a nohup.out
    file that is excessively large, which could end up taking up too much space on the SD card, jeopardizing data recording.
    """   
    global object_report
    while testing_mode == True:
        try:
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"{RESET}{'-' * 100}{RESET}" '\n'
                f"{'CPU time:':<18}{MAGENTA}{timestamp:<10}{RESET}{'Local':<10} {'Sunrise:':<18}{'None'}{' UTC':<10} {'Temperature (°C):':<20}{int_temp:<20.1f}" '\n'
                f"{'GPS time:':<18}{BLUE}{gps_time:<10}{RESET}{'UTC':<10} {'Sunset:':<18}{'None'}{' UTC':<10} {'Humidity (%):':<20}{int_humid:<20.1f}" '\n'
                f"{'Lat:':<18}{gps_lat:<20.6f} {'Track (°):':<18}{gps_trk:<14} {'Bus Voltage (V):':<20}{voltage:<5.1f}" '\n'
                f"{'Lng:':<17}{gps_lon:<21.6f} {'Speed (kts):':<18}{gps_spd:<14} {'Bus Current (mA):':<20}{current:<5.1f}" '\n'
                f"{'GPS Alt (M):':<18}{gps_alt:<20.1f} {'Satellites:':<18}{gps_sat:<14} {'Bus Power (mW):':<20}{power:<5.0f}" '\n'
                f"{'GPS Valid:':<18}{GREEN if gps_valid else RED}{'Valid' if gps_valid else 'NO GPS':<21}{RESET}{'Location:':<18}{RESET if gps_valid else RED}http://maps.google.com/?q={map_link}{RESET}" '\n'
                f"{'Flight status:':<18}{GREEN if airborne else ORANGE}{'Airborne' if airborne else 'Ground':<21}{RESET}{'Geofenced:':<18}{GREEN if contained else RED}{'Contained' if contained else 'OUTSIDE':<21}{RESET}" '\n'
                f"{'Flight time:':<18}{CYAN}{flight_time:<21}{RESET}{'Time limit:':<18}{flight_time_limit:<20}" '\n'
                f"{'Trigger:':<18}{ORANGE}{trigger:<21}{RESET}{'Intact:':<18}{'True' if intact else 'False':<20}" '\n'
                #f"{'Max Alt:':<18}{max_alt:<21}{'Mode:':<18}{'Climbing' if climbing else 'Cruising' if cruising else 'Descending' if descending else 'Ground':<20}")
                f"{MAGENTA}{'CSV update:':<18}{GREEN}{record_time}{RESET}" '\n'
                f"{BLUE}{'Message:':<18}{YELLOW}{object_report}{RESET}" '\n'
                f"{BLUE}{'Transmit time:':<18}{RESET}{tx_time}{' s'}" '\n'
                f"{BLUE}{'Data rate:':<18}{RESET}{tx_rate}{' byte/s'}" '\n'
                f"{BLUE}{'Timestamp:':<18}{YELLOW}{msg_sent}{RESET}\n" '\n'
                f"{RESET}{'Launch Alt:':<18}{RESET}{launch_alt:<21}{RESET}{'Launch Alt Set:':<18}{ORANGE}{launch_alt_set:<21}{RESET}" '\n'
                f"{RESET}{'Max Alt:':<18}{RESET}{max_alt:<21}{RESET}{'Landed:':<18}{ORANGE}{landed:<21}{RESET}" '\n'
                f"{RESET}{'-' * 100}{RESET}" '\n'
            )
            await asyncio.sleep(display_interval)   
        except Exception as e:
            print(f"\n{RED}{'Display Error:':<25}{RESET}{e}\n")
            break


async def set_launch_alt():  #~~~~~ TASK 4 ~~~~~    
    """
    In our efforts to simplify the device and code, we wanted a smart way to trigger the airborne timer, which currently
    starts as soon as the program is running. The most logical choice is to use the GPS system to determine when the baloon 
    starts flying by watching the altitude change, which means we need to know the altitude at the launch site. If we try to enter
    this manually, it opens us up to human error entering the launch site elevation. Automating this means the GPS will tell
    us what the launch site elevtion is; however, the GPS location tends to 'bounce around' even when sitting still. We can solve 
    this by taking several altitude measurements over time and averaging them to determine the launch site elevation (launch_alt).
    - The launch site elevation is then used to determine when the balloon is airborne after crossing a height-above-launch 
    threshold, currently the variable 'airborne_delta'
    """   
    global launch_alt, launch_alt_set
    readings = []
   
    gps_timeout = 30  # Timeout after 30 seconds of waiting for GPS
    gps_wait_start = asyncio.get_event_loop().time()
    while not gps_valid:    # Wait for GPS signal lock with timeout function to avoid endlessly waiting
        if asyncio.get_event_loop().time() - gps_wait_start > gps_timeout:
            print(f"\n{RED}GPS timeout - no lock acquired after {gps_timeout} seconds{RESET}")
            launch_alt = -5
            launch_alt_set = True
            return launch_alt
        await asyncio.sleep(0.5)
    
    start_time = asyncio.get_event_loop().time()
    while asyncio.get_event_loop().time() - start_time < 20:
        if gps_valid and gps_alt is not None:
            readings.append(gps_alt)
            #print(f"Reading: {gps_alt}m")       # Remove this in the flight code
        await asyncio.sleep(1)
    
    if readings:
        launch_alt= round(sum(readings) / len(readings), 1)
        if testing_mode:    
            launch_alt = -99
            launch_alt_set = True
            #print(f"\n{YELLOW}{'!!! Testing mode is ACTIVE; launch altitude is set to '}{launch_alt} !!!{RESET}")
        #print(f"\n{MAGENTA}{'Launch altitude:':<25}{YELLOW}{launch_alt}m{RESET}\n")  #<<<<< This can be removed since it will be displayed in the printouts
    else:
        launch_alt = -33
        launch_alt_set = True
        print(f"\n{RED}>>>No valid altitude readings collected<<<{RESET}")
    #print(f"\n{MAGENTA}{'Launch altitude set:':<25}{YELLOW}{launch_alt_set}{RESET}\n")
    return launch_alt


async def assess_airborne():  #~~~~~ TASK 5 ~~~~~
    """
    - The moment the balloon crosses the altitude_delta, the balloon is climbing. At some point the balloon will reach peak altitude
    and begin to float. We must determine when this happens. 
    """
    global airborne, contained, status_led, strobe_led, max_alt, min_alt, landed, climbing
    landed_iteration = 0
    while not landed:
        await asyncio.sleep(3)   
        if (asyncio.get_event_loop().time() - preflight_start) > 300:  # 5-minute buffer before airborne mode auto activates
            airborne = True 
        try:
            # Box is on the ground and will determine if airborne
            if gps_alt < (launch_alt + airborne_delta): # System is on the ground
                if gps_valid and contained:
                    if computer_type == "A" or "C":
                        status_led.value = relay_on # This indicates the code is running properly and is flight-ready
            else:   # System is airborne
                airborne = True
                if computer_type == "A" or "C":
                    status_led.value = relay_off    # Turn off status light to conserve power
                #Somewhere we will need to turn on the strobe lights if its nighttime
                if gps_alt > max_alt:   # System is climbing
                    max_alt = gps_alt
                    min_alt = gps_alt
                    if (min_alt + 333) > max_alt:   # Min/Max spread < 1,000'
                        climbing = True
                if gps_alt < min_alt:   # System is descending
                    min_alt = gps_alt
                    if (min_alt + 333) < max_alt:   # Min/Max spread > 1,000'
                        climbing = False
                if min_alt < 3333 and gps_alt > min_alt and not climbing:
                    # System is <10k' MSL, has stopped descending, and is < the airborne delta     
                    if gps_spd < 5: 
                        landed_iteration += 1
                    if landed_iteration > 3:
                        #airborne = False 
                        landed = True            
        except Exception as e:
            print(f"\n{RED}{'Assessment error:':<25}{RESET}{e}\n") 
            pass      


async def environmental_monitor():  #~~~~~ TASK 6 ~~~~~
    """
    This section controls the DHT-22 sensor measuring temperature and humidity. It should only run on the A computer
    """
    global int_temp, int_humid
    while computer_type == "A":
        try:
            await asyncio.sleep(sensor_interval)
            result = sensor_dht22.read()
            if 'temp_c' in result and 'humidity' in result:     # Ensure the result contains the expected data
                raw_temp = result['temp_c']
                int_temp = round(-1 * (raw_temp + 3276.8), 1) if raw_temp < 0 else round(raw_temp, 1)  # known error with sub-zero temps
                int_humid = round(float(result['humidity']), 1)     # Directly convert the formatted string to a float
            else:
                print(f"\n{RED}{'DHT-22 data missing':<25}{RESET}\n")   # Handle cases where 'temp_c' or 'humidity' is missing in the result
        except Exception as e:
            print(f"\n{RED}{'DHT-22 error:':<25}{RESET}{e}\n")
        await asyncio.sleep(600)
        #print_mark(5)


async def electrical_monitor():  #~~~~~ TASK 7 ~~~~~
    """
    This section controls the INA-219 electrical sensor measuring voltage, current, & power. It should only run on the A computer
    """
    global voltage, current, power, charge
    while computer_type == "A":
        try:
            await asyncio.sleep(sensor_interval)
            """voltage = ina.voltage()
            current = ina.current()
            power = ina.power()
            
            """
            #Check this in the preflight code prior to putting into use
            voltage = float("{:.1f}".format(ina.voltage))
            current = float("{:.1f}".format(ina.current))
            power = float("{:.1f}".format(ina.power))
            charge = 100 * ((voltage-9.5)/(12.22-9.5)) # full = 12.22v, empty = 9.5v, dead = 8.6v
            
        except DeviceRangeError as e:
            print(f'\n{RED}{"INA-219 error:":<25}{RESET}{e}\n')
        await asyncio.sleep(10) # Wait 10 sec prior to next reading
        # print_mark(6)


async def baro_monitor():  #~~~~~ TASK 8 ~~~~~   *** THIS IS NOT INSTALLED ***
    """
    This section controls the HX-710B pressure sensor and is rated to very low pressure. It should only run on the A computer
    - The code has not yet been written because I have not had the time
    """
    global baro_alt
    while computer_type == "A":
        try:
            await asyncio.sleep(sensor_interval)
            baro_alt = 999
        except Exception as e:
            print(f'\n{RED}{"HX710B error:":<25}{RESET}{e}\n')
        await asyncio.sleep(sensor_interval)
        #print_mark(7)              
        
     
# ---------- COMMUNICATIONS ---------- 
SOURCE_ADDRESS = 'KW5AUS'
SOURCE_SSID = 11
DEST_ADDRESS = 'APRS'
DEST_SSID = ''
PATH_ADDRESS = 'WIDE2'
PATH_SSID = 2 
FLAG = 0x7e   
CONTROL_FIELD = 0x03           
PROTOCOL_ID = 0xF0      # A PID value of 0xF0 is used to specify text content


def convert_coordinates(coordinate, is_latitude=True):
    degrees = int(coordinate)       # Extract the degrees part
    minutes = abs(coordinate - degrees) * 60
    
    if is_latitude:
        # Latitude: 2 digits for degrees, 2 for minutes (to two decimal places), followed by N or S
        ddmm = f"{abs(degrees):02d}{minutes:05.2f}"  # 2 digits for degrees, 4 for minutes
        direction = 'N' if coordinate >= 0 else 'S'
        return f"{ddmm}{direction}"  # Total length = 8 characters
    else:
        # Longitude: 3 digits for degrees, 2 for minutes (to two decimal places), followed by E or W
        ddmm = f"{abs(degrees):03d}{minutes:05.2f}"  # 3 digits for degrees, 4 for minutes
        direction = 'E' if coordinate >= 0 else 'W'
        return f"{ddmm}{direction}"  # Total length = 9 characters

 
async def create_obj_report():
    """
    This section creates & formats the 'Object Report' for placement in the Information Field of the AX.25 message.
    """ 
    global object_report
    
    info_field_data_id = ";"                # The ; is the APRS Data Type Identifier for an Object Report
    object_name = "SABER_" + balloon_id     # Fixed 9-character Object name, which may consist of any printable ASCII characters
    alive_killed = '*'                      # a * or _ separates the Object name from the rest of the report '*' = live Object. '_' = killed Object
    aprs_timestamp = f"{gps_day}{gps_time[:2]}{gps_time[3:5]}z"  # 7 bytes (DDHHMMz)
    aprs_lat = convert_coordinates(gps_lat, True)
    sym_table_id = "/"
    aprs_lon = convert_coordinates(gps_lon, False)
    symbol_code = "O"                       # Primary Symbol Table, Balloon = "O" (SSID -11)
    crs_spd = f"{int(gps_trk):03d}/{int(gps_spd):03d}"
    aprs_comment = f"++Alt:{gps_alt}m_{round(flight_time / 60, 1)}min^{'Intact' if intact else 'Killed'}>{trigger}<"   # Max 43 Characters
            
    object_report = (
        f"{info_field_data_id}{object_name}{alive_killed}{aprs_timestamp}"
        f"{aprs_lat}{sym_table_id}{aprs_lon}{symbol_code}{crs_spd}{aprs_comment}"
    )
    return object_report        


async def transmit_report():  
    """
    This section takes the UI framte byte array and then transmits the message
    - The purpose for this formating is to integrate with APRS. If we are unable to get the message to upload to the APRS network,
    we can use a simpler message format
    """  
    global tx_counter, msg_sent, object_report, tx_time, tx_rate
    try:
        object_report = await create_obj_report()      # Message formatted as byte array
        message_list = list(object_report.encode('utf-8'))               # Converts the byte array to a list of integers because LoRa.write() expects a list of integers
        
        LoRa.beginPacket()
        LoRa.write(message_list, len(message_list))     # This sends the message, which is now a list of integers
        LoRa.write([tx_counter], 1)     # This sends the counter value, which is likely an additional byte appended to the message, perhaps to indicate a message sequence number or packet identifier.
        LoRa.endPacket()
        LoRa.wait()
        
        tx_counter = (tx_counter + 1) % 256
        msg_sent = datetime.now().strftime("%H:%M:%S")
        tx_time = f"{LoRa.transmitTime() / 1000:.2f}"
        tx_rate = f"{LoRa.dataRate():.2f}"
    except Exception as e:
        print(f"\n{RED}{'Transmit Error:':<25}{RESET}{e}\n")
         
      
async def periodic_update():  #~~~~~ TASK 9 ~~~~~
    """
    - This code sends the position update with 'update_interval'*60 minutes between messages. 
    - Needs: update to deconflict the balloon transmissions based on the time of day so two balloons 
    are not transmitting over each other and blocking the signal.
    - Only the A and C computers are equipped with transmitters
    """  
    while computer_type == "A" or "C":
        for _ in range(msg_iterations):  # Loop for a fixed number of iterations
            await transmit_report()  # Call the async function
            await asyncio.sleep(msg_interval)  
        if testing_mode == True:
            print(f"{MAGENTA}{'Messages sent:':<25}{CYAN}{msg_iterations}{RESET} at {msg_sent} on {LoRa._frequency / 1000000:.3f} MHz")
            print(f"{BLUE}{'Transmit time:':<25}{RESET}{LoRa.transmitTime() / 1000:0.2f}{' s'}")
            print(f"{BLUE}{'Data rate:':<25}{RESET}{LoRa.dataRate():0.2f}{' byte/s'}")
            print("----------------------------------------------------------------------------------------------")
        await asyncio.sleep(update_interval * 60)  # Wait some fixed number of minutes before the next update
        
            
#-------------------- TERMINATION --------------------
async def time_trigger(airborne):   #~~~~~ TASK 10 ~~~~~
    """
    - This is the termination trigger based on timing. Once the balloon gets airborne (indicated by airborne = True), the timer
    will start and will not stop or reset
    - Once the flight time has passed the flight_time_limit, the balloon will initiate termination and then record the trigger
    - To avoid repeated termination commands, the 'intact' variable is changed to False to prevent another termination trigger
    """
    global start_time, flight_time, trigger, intact
    while True:
        if airborne() and start_time is None:    
            start_time = asyncio.get_event_loop().time()
        if start_time is not None:
            flight_time = int(asyncio.get_event_loop().time() - start_time)
            if flight_time > flight_time_limit and intact:
                await terminate_balloon()
                trigger = "Timing"
                intact = False  
            else:
                pass
        await asyncio.sleep(5)  # Update every 5 seconds


async def geofencing(airborne):  #~~~~~ TASK 11 ~~~~~
    """
    - This is the termination trigger based on geofencing. Once the balloon gets airborne (indicated by airborne = True), it will
    assess its position relative to the operating area polygon. If the balloon leaves the polygon, it will initiate termination
    - To avoid repeated termination commands, the 'intact' variable is changed to False to prevent another termination trigger
    """
    global gps_lat, gps_lon, polygon, contained, trigger, intact
    while True:
        try:
            location = Point(gps_lat, gps_lon)
            contained = polygon.contains(location)
            if gps_valid and airborne():
                if not contained:
                    await asyncio.sleep(10) # Wait for 10 seconds to check if the location is still outside
                    # Recheck location after waiting
                    location = Point(gps_lat, gps_lon)
                    contained = polygon.contains(location)
                    if intact and not contained:  # Intact avoids repeated termination commands
                        await terminate_balloon()
                        trigger = "Geofencing"
                        intact = False
            else:
                pass
        except Exception as e:
            print(f'\n{RED}{"Geolocation error:":<30}{RESET}{e}\n')
        await asyncio.sleep(10) # Wait 10 sec prior to next assessment


async def terminate_balloon():  
    """
    - This code runs the actual termination sequency by commanding the servo to open and then turning on the nichrome in the 
    off-chance the servo failed to release the retention string
    - Upon termination the computer will transmit a position report
    """
    global intact
    try:
        print(f'{CYAN}{"Termination has been commanded."}{RESET}\n')
        
        # Servo release
        if computer_type == "A" or "C":
            timestamp = datetime.now().strftime("%H:%M:%S")
            servo.value = servo_open
            print(f'{MAGENTA}{"Servo opened":<25}{RESET}{timestamp}')  # Release the line
            await asyncio.sleep(3)
        
        # Nichrome release
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f'{MAGENTA}{"Nichrome ON":<25}{RESET}{timestamp}') 
        heat_element.value = relay_on  
        await asyncio.sleep(heat_time)
        heat_element.value = relay_off  
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f'{MAGENTA}{"Nichrome OFF":<25}{RESET}{timestamp}\n') 
        print(f'{GREEN}{"Termination complete":<25}{RESET}\n') 
        if computer_type == "A" or "C":
            await transmit_report()     # Send an update at termination
        else:
            pass
    except Exception as e:
            print(f'\n{RED}{"Termination error:":<25}{RESET}{e}\n')                       
                     

#-------------------- MAIN FUNCTION --------------------
async def main():
    task1 = asyncio.create_task(gps())
    task2 = asyncio.create_task(record())
    task3 = asyncio.create_task(display())
    task4 = asyncio.create_task(set_launch_alt())
    task5 = asyncio.create_task(assess_airborne())
    task6 = asyncio.create_task(environmental_monitor())
    task7 = asyncio.create_task(electrical_monitor())
    #task8 = asyncio.create_task(baro_monitor())
    task9 = asyncio.create_task(periodic_update()) 
    task10 = asyncio.create_task(time_trigger(lambda: airborne))
    task11 = asyncio.create_task(geofencing(lambda: airborne))
    
    
    await task1
    await task2
    await task3
    await task4
    await task5
    await task6
    await task7
    #await task8
    await task9
    await task10
    await task11
    
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\n', "User terminated program.")

