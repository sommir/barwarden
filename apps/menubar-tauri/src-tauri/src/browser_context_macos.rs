use std::ffi::c_void;
use std::mem::MaybeUninit;
use std::ptr;

use crate::browser_context::{
    ActiveTabReadError, ActiveTabReader, BrowserFamily, CapturedBrowserTarget,
};

type DescType = u32;
type AEEventClass = u32;
type AEEventId = u32;
type AEKeyword = u32;
type AEAddressDesc = AEDesc;
type AppleEvent = AEDesc;
type OSStatus = i32;

#[repr(C)]
struct AEDesc {
    descriptor_type: DescType,
    data_handle: *mut c_void,
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AECreateDesc(
        descriptor_type: DescType,
        data_ptr: *const c_void,
        data_size: isize,
        result: *mut AEDesc,
    ) -> OSStatus;
    fn AEDisposeDesc(descriptor: *mut AEDesc) -> OSStatus;
    fn CreateObjSpecifier(
        desired_class: DescType,
        container: *const AEDesc,
        key_form: DescType,
        key_data: *const AEDesc,
        dispose_inputs: u8,
        result: *mut AEDesc,
    ) -> OSStatus;
    fn AECreateAppleEvent(
        event_class: AEEventClass,
        event_id: AEEventId,
        target: *const AEAddressDesc,
        return_id: i16,
        transaction_id: i32,
        result: *mut AppleEvent,
    ) -> OSStatus;
    fn AEPutParamDesc(
        event: *mut AppleEvent,
        keyword: AEKeyword,
        descriptor: *const AEDesc,
    ) -> OSStatus;
    fn AEDeterminePermissionToAutomateTarget(
        target: *const AEAddressDesc,
        event_class: AEEventClass,
        event_id: AEEventId,
        ask_user_if_needed: u8,
    ) -> OSStatus;
    fn AESendMessage(
        event: *const AppleEvent,
        reply: *mut AppleEvent,
        send_mode: i32,
        time_out_in_ticks: i32,
    ) -> OSStatus;
    fn AEGetParamDesc(
        event: *const AppleEvent,
        keyword: AEKeyword,
        desired_type: DescType,
        result: *mut AEDesc,
    ) -> OSStatus;
    fn AEGetParamPtr(
        event: *const AppleEvent,
        keyword: AEKeyword,
        desired_type: DescType,
        actual_type: *mut DescType,
        data_ptr: *mut c_void,
        maximum_size: isize,
        actual_size: *mut isize,
    ) -> OSStatus;
    fn AECoerceDesc(descriptor: *const AEDesc, to_type: DescType, result: *mut AEDesc) -> OSStatus;
    fn AEGetDescDataSize(descriptor: *const AEDesc) -> isize;
    fn AEGetDescData(
        descriptor: *const AEDesc,
        data_ptr: *mut c_void,
        maximum_size: isize,
    ) -> OSStatus;
}

const NO_ERR: OSStatus = 0;
const ERR_AE_EVENT_NOT_PERMITTED: OSStatus = -1743;
const ERR_AE_TIMEOUT: OSStatus = -1712;
const ERR_AE_NO_SUCH_OBJECT: OSStatus = -1728;
const ERR_APP_NOT_FOUND: OSStatus = -600;
const ERR_CONNECTION_INVALID: OSStatus = -609;

const TYPE_NULL: DescType = four_cc(*b"null");
const TYPE_KERNEL_PROCESS_ID: DescType = four_cc(*b"kpid");
const TYPE_SINT32: DescType = four_cc(*b"long");
const TYPE_TYPE: DescType = four_cc(*b"type");
const TYPE_PROPERTY: DescType = four_cc(*b"prop");
const TYPE_WILDCARD: DescType = four_cc(*b"****");
const TYPE_UTF8_TEXT: DescType = four_cc(*b"utf8");
const FORM_ABSOLUTE_POSITION: DescType = four_cc(*b"indx");
const FORM_PROPERTY_ID: DescType = four_cc(*b"prop");
const CORE_EVENT_CLASS: AEEventClass = four_cc(*b"core");
const GET_DATA_EVENT: AEEventId = four_cc(*b"getd");
const KEY_DIRECT_OBJECT: AEKeyword = four_cc(*b"----");
const KEY_ERROR_NUMBER: AEKeyword = four_cc(*b"errn");
const AUTO_GENERATE_RETURN_ID: i16 = -1;
const ANY_TRANSACTION_ID: i32 = 0;
const WAIT_REPLY: i32 = 3;
const MAXIMUM_URL_BYTES: usize = 8192;

pub(crate) const APPLE_EVENT_TIMEOUT_TICKS: i32 = 120;

pub(crate) const fn four_cc(bytes: [u8; 4]) -> u32 {
    u32::from_be_bytes(bytes)
}

pub(crate) fn browser_query(family: BrowserFamily) -> [DescType; 3] {
    match family {
        BrowserFamily::Safari => [four_cc(*b"cwin"), four_cc(*b"cTab"), four_cc(*b"pURL")],
        BrowserFamily::Chromium => [four_cc(*b"cwin"), four_cc(*b"acTa"), four_cc(*b"URL ")],
    }
}

struct OwnedDesc(AEDesc);

impl OwnedDesc {
    fn create(descriptor_type: DescType, bytes: &[u8]) -> Result<Self, OSStatus> {
        let mut output = MaybeUninit::<AEDesc>::uninit();
        let data_ptr = if bytes.is_empty() {
            ptr::null()
        } else {
            bytes.as_ptr().cast()
        };
        let status = unsafe {
            AECreateDesc(
                descriptor_type,
                data_ptr,
                bytes.len() as isize,
                output.as_mut_ptr(),
            )
        };
        if status == NO_ERR {
            Ok(Self(unsafe { output.assume_init() }))
        } else {
            Err(status)
        }
    }

    fn output(operation: impl FnOnce(*mut AEDesc) -> OSStatus) -> Result<Self, OSStatus> {
        let mut output = MaybeUninit::<AEDesc>::uninit();
        let status = operation(output.as_mut_ptr());
        if status == NO_ERR {
            Ok(Self(unsafe { output.assume_init() }))
        } else {
            Err(status)
        }
    }

    fn null() -> Result<Self, OSStatus> {
        Self::create(TYPE_NULL, &[])
    }

    fn sint32(value: i32) -> Result<Self, OSStatus> {
        Self::create(TYPE_SINT32, &value.to_ne_bytes())
    }

    fn type_code(value: DescType) -> Result<Self, OSStatus> {
        Self::create(TYPE_TYPE, &value.to_ne_bytes())
    }

    fn as_ptr(&self) -> *const AEDesc {
        &self.0
    }

    fn as_mut_ptr(&mut self) -> *mut AEDesc {
        &mut self.0
    }
}

impl Drop for OwnedDesc {
    fn drop(&mut self) {
        let _ = unsafe { AEDisposeDesc(self.as_mut_ptr()) };
    }
}

fn object_by_index(
    class_code: DescType,
    container: &OwnedDesc,
    index: i32,
) -> Result<OwnedDesc, OSStatus> {
    let key = OwnedDesc::sint32(index)?;
    OwnedDesc::output(|output| unsafe {
        CreateObjSpecifier(
            class_code,
            container.as_ptr(),
            FORM_ABSOLUTE_POSITION,
            key.as_ptr(),
            0,
            output,
        )
    })
}

fn property(container: &OwnedDesc, property_code: DescType) -> Result<OwnedDesc, OSStatus> {
    let key = OwnedDesc::type_code(property_code)?;
    OwnedDesc::output(|output| unsafe {
        CreateObjSpecifier(
            TYPE_PROPERTY,
            container.as_ptr(),
            FORM_PROPERTY_ID,
            key.as_ptr(),
            0,
            output,
        )
    })
}

fn query_descriptor(family: BrowserFamily) -> Result<OwnedDesc, OSStatus> {
    let [window_class, tab_property, url_property] = browser_query(family);
    let root = OwnedDesc::null()?;
    let window = object_by_index(window_class, &root, 1)?;
    let tab = property(&window, tab_property)?;
    property(&tab, url_property)
}

fn target_descriptor(process_id: i32) -> Result<OwnedDesc, OSStatus> {
    OwnedDesc::create(TYPE_KERNEL_PROCESS_ID, &process_id.to_ne_bytes())
}

fn apple_event(target: &OwnedDesc, query: &OwnedDesc) -> Result<OwnedDesc, OSStatus> {
    let mut event = OwnedDesc::output(|output| unsafe {
        AECreateAppleEvent(
            CORE_EVENT_CLASS,
            GET_DATA_EVENT,
            target.as_ptr(),
            AUTO_GENERATE_RETURN_ID,
            ANY_TRANSACTION_ID,
            output,
        )
    })?;
    let status = unsafe { AEPutParamDesc(event.as_mut_ptr(), KEY_DIRECT_OBJECT, query.as_ptr()) };
    if status == NO_ERR {
        Ok(event)
    } else {
        Err(status)
    }
}

fn reply_error(reply: &OwnedDesc) -> Option<OSStatus> {
    let mut value = 0_i32;
    let mut actual_type = 0_u32;
    let mut actual_size = 0_isize;
    let status = unsafe {
        AEGetParamPtr(
            reply.as_ptr(),
            KEY_ERROR_NUMBER,
            TYPE_SINT32,
            &mut actual_type,
            (&mut value as *mut i32).cast(),
            std::mem::size_of::<i32>() as isize,
            &mut actual_size,
        )
    };
    (status == NO_ERR && actual_size == std::mem::size_of::<i32>() as isize && value != 0)
        .then_some(value)
}

fn utf8_direct_object(reply: &OwnedDesc) -> Result<String, ActiveTabReadError> {
    let direct = OwnedDesc::output(|output| unsafe {
        AEGetParamDesc(reply.as_ptr(), KEY_DIRECT_OBJECT, TYPE_WILDCARD, output)
    })
    .map_err(map_result_status)?;
    let utf8 = OwnedDesc::output(|output| unsafe {
        AECoerceDesc(direct.as_ptr(), TYPE_UTF8_TEXT, output)
    })
    .map_err(map_result_status)?;
    let size = unsafe { AEGetDescDataSize(utf8.as_ptr()) };
    if size <= 0 || size as usize > MAXIMUM_URL_BYTES {
        return Err(ActiveTabReadError::InvalidResult);
    }
    let mut bytes = vec![0_u8; size as usize];
    let status = unsafe { AEGetDescData(utf8.as_ptr(), bytes.as_mut_ptr().cast(), size) };
    if status != NO_ERR {
        return Err(map_result_status(status));
    }
    String::from_utf8(bytes).map_err(|_| ActiveTabReadError::InvalidResult)
}

fn map_permission_status(status: OSStatus) -> ActiveTabReadError {
    if status == ERR_AE_EVENT_NOT_PERMITTED {
        ActiveTabReadError::PermissionDenied
    } else {
        map_send_status(status)
    }
}

fn map_send_status(status: OSStatus) -> ActiveTabReadError {
    match status {
        ERR_AE_TIMEOUT => ActiveTabReadError::Timeout,
        ERR_AE_NO_SUCH_OBJECT => ActiveTabReadError::NoActiveTab,
        ERR_APP_NOT_FOUND | ERR_CONNECTION_INVALID => ActiveTabReadError::BrowserUnavailable,
        ERR_AE_EVENT_NOT_PERMITTED => ActiveTabReadError::PermissionDenied,
        _ => ActiveTabReadError::BrowserUnavailable,
    }
}

fn map_result_status(status: OSStatus) -> ActiveTabReadError {
    match status {
        ERR_AE_NO_SUCH_OBJECT => ActiveTabReadError::NoActiveTab,
        ERR_AE_TIMEOUT => ActiveTabReadError::Timeout,
        ERR_APP_NOT_FOUND | ERR_CONNECTION_INVALID => ActiveTabReadError::BrowserUnavailable,
        ERR_AE_EVENT_NOT_PERMITTED => ActiveTabReadError::PermissionDenied,
        _ => ActiveTabReadError::InvalidResult,
    }
}

#[derive(Default)]
pub(crate) struct MacActiveTabReader;

impl ActiveTabReader for MacActiveTabReader {
    fn read_url(
        &self,
        target: &CapturedBrowserTarget,
        family: BrowserFamily,
    ) -> Result<String, ActiveTabReadError> {
        let target_descriptor = target_descriptor(target.process_id).map_err(map_send_status)?;
        let permission = unsafe {
            AEDeterminePermissionToAutomateTarget(
                target_descriptor.as_ptr(),
                CORE_EVENT_CLASS,
                GET_DATA_EVENT,
                1,
            )
        };
        if permission != NO_ERR {
            return Err(map_permission_status(permission));
        }

        let query = query_descriptor(family).map_err(map_result_status)?;
        let event = apple_event(&target_descriptor, &query).map_err(map_send_status)?;
        let mut reply = OwnedDesc::null().map_err(map_send_status)?;
        let status = unsafe {
            AESendMessage(
                event.as_ptr(),
                reply.as_mut_ptr(),
                WAIT_REPLY,
                APPLE_EVENT_TIMEOUT_TICKS,
            )
        };
        if status != NO_ERR {
            return Err(map_send_status(status));
        }
        if let Some(status) = reply_error(&reply) {
            return Err(map_result_status(status));
        }
        utf8_direct_object(&reply)
    }
}

#[cfg(test)]
mod tests {
    use super::{browser_query, four_cc, APPLE_EVENT_TIMEOUT_TICKS};
    use crate::browser_context::BrowserFamily;

    #[test]
    fn family_queries_use_the_browser_scripting_dictionary_codes() {
        assert_eq!(
            browser_query(BrowserFamily::Safari),
            [four_cc(*b"cwin"), four_cc(*b"cTab"), four_cc(*b"pURL")],
        );
        assert_eq!(
            browser_query(BrowserFamily::Chromium),
            [four_cc(*b"cwin"), four_cc(*b"acTa"), four_cc(*b"URL ")],
        );
        assert_eq!(APPLE_EVENT_TIMEOUT_TICKS, 120);
    }
}
